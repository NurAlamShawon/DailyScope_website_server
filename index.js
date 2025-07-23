require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.tbuverl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

//for access token

var admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FIRE_SERVICE_KEY, "base64").toString(
  "utf8"
);
var serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// // // middleware for verify token

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decode = await admin.auth().verifyIdToken(token);
    req.decoded = decode;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized" });
  }
};

//for payment
const stripe = require("stripe")(process.env.PAYMENT_KEY, {
  apiVersion: "2025-05-28.basil",
});

app.use(express.static("public"));

//post payment

app.post("/create-payment-intent", async (req, res) => {
  const amountInCent = req.body.amountInCent;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCent, // Amount in cents
      currency: "usd",
      payment_method_types: ["card"],
      // Optional: Add metadata or a customer ID
      // metadata: {order_id: '6735'}
    });

    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );

    const database = client.db("DailyScope");
    // const parcelcollection = database.collection("parcels");
    const articlecollection = database.collection("articles");
    // const paymentcollection = database.collection("payments");
    const userscollection = database.collection("users");

    //middleware for verify admin

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      console.log("Decoded Email:", req.decoded.email);
      const query = { email };
      const user = await userscollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden" });
      }

      next();
    };

    //middleware for verify admin

    const verifyRider = async (req, res, next) => {
      const email = req.decoded.email;
      console.log("Decoded Email:", req.decoded.email);
      const query = { email };
      const user = await userscollection.findOne(query);
      if (!user || user.role !== "rider") {
        return res.status(403).send({ message: "forbidden" });
      }

      next();
    };

    //users
    //post user

    app.post("/users", async (req, res) => {
      const { name, email, role, created_At, last_log_in } = req.body;

      if (!email || !name) {
        return res.status(400).send({ error: "Missing name or email" });
      }

      try {
        const existingUser = await userscollection.findOne({ email });

        if (existingUser) {
          console.log("Existing user?", existingUser);
          return res.status(200).send(existingUser); // already exists
        }

        const newUser = {
          name,
          email,
          role: role || "user", // fallback to 'user'
          created_At: created_At || new Date().toISOString(),
          last_log_in: last_log_in || new Date().toISOString(),
        };

        await userscollection.insertOne(newUser);
        res.status(201).send(newUser);
      } catch (err) {
        console.error("User save failed:", err);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    //  GET user
    app.get("/users", async (req, res) => {
      const emailQuery = req.query.email;
      console.log(emailQuery);
      const regex = new RegExp(emailQuery, "i");

      try {
        const users = await userscollection
          .find({ email: { $regex: regex } })
          .limit(10)
          .toArray();
        res.send(users);
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: err.message });
      }
    });

    //add subscribe
    app.post("/users/subscribe", async (req, res) => {
      const { email, subscribe, premiumExpiresAt } = req.body;
      const result = await userscollection.updateOne(
        { email },
        {
          $set: {
            subscribe,
            premiumExpiresAt,
          },
        }
      );
      res.send(result);
    });

    //post update about subscribe
    app.post("/users/expire-subscription", async (req, res) => {
      const { email } = req.body;
      try {
        const result = await userscollection.updateOne(
          { email },
          {
            $set: {
              subscribe: null,
              premiumExpiresAt: null,
            },
          }
        );
        res.send({ success: true, result });
      } catch (error) {
        res.status(500).send({ error: "Failed to expire subscription" });
      }
    });

    // get role
    app.get("/users/role", async (req, res) => {
      const { email } = req.query;

      if (!email) {
        return res.status(400).json({ error: "Email query param is required" });
      }

      try {
        const user = await userscollection.findOne({
          email: email.toLowerCase(),
        });
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }
        res.json({ role: user.role });
      } catch (error) {
        console.error("Error fetching role:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    //make user to admin
    app.put("/users/:id/make-admin", async (req, res) => {
      const userId = req.params.id;

      try {
        const result = await userscollection.updateOne(
          { _id: new ObjectId(String(userId)) },
          {
            $set: {
              role: "admin",
            },
          }
        );
        res.send(result);
      } catch (error) {
        console.error("Error updating role:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // make admin to user
    app.put("/users/:id/remove-admin", async (req, res) => {
      const userId = req.params.id;

      try {
        const result = await userscollection.updateOne(
          { _id: new ObjectId(String(userId)) },
          {
            $set: {
              role: "user",
            },
          }
        );
        res.send(result);
      } catch (error) {
        console.error("Error updating role:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // //Parcels

    // // get parcel

    // app.get("/parcels", verifyFirebaseToken, async (req, res) => {
    //   try {
    //     const { email, payment_status, delivery_status } = req.query;

    //     const query = {};

    //     if (email) {
    //       query.email = email;
    //     }
    //     if (payment_status) {
    //       query.payment_status = payment_status;
    //     }
    //     if (delivery_status) {
    //       query.delivery_status = delivery_status;
    //     }

    //     const parcels = await parcelcollection
    //       .find(query)
    //       .sort({ creation_date: -1 })
    //       .toArray();

    //     console.log("Parcels found:", parcels.length);
    //     res.send(parcels);
    //   } catch (error) {
    //     console.error("Error fetching parcels:", error);
    //     res.status(500).send({ message: "Internal server error" });
    //   }
    // });

    // //get parcel by id

    // app.get("/parcels/:id", verifyFirebaseToken, async (req, res) => {
    //   const id = req.params.id;
    //   const query = { _id: new ObjectId(id) };
    //   const result = await parcelcollection.findOne(query);
    //   res.send(result);
    // });

    // // post parcel
    // app.post("/parcels", async (req, res) => {
    //   const parcel = req.body;

    //   parcel.logs = [
    //     {
    //       status: "Created",
    //       timestamp: new Date(),
    //       note: "Parcel created by user",
    //     },
    //   ];

    //   const result = await parcelcollection.insertOne(parcel);
    //   res.send(result);
    // });

    // //parcel delete
    // app.delete("/parcels/:id", async (req, res) => {
    //   const id = req.params.id;

    //   const query = { _id: new ObjectId(id) };
    //   const result = await parcelcollection.deleteOne(query);

    //   res.send(result);
    // });

    // // Get parcels assigned to rider with status not-collected
    // app.get(
    //   "/parcels/rider/pending",
    //   verifyFirebaseToken,
    //   verifyRider,
    //   async (req, res) => {
    //     try {
    //       const riderEmail = req.query.email;
    //       const status = req.query.status;
    //       console.log("Rider email:", riderEmail);

    //       if (!riderEmail) {
    //         console.log("Missing email");
    //         return res.status(400).send({ error: "Email required" });
    //       }

    //       const parcels = await parcelcollection
    //         .find({ assigned_rider_email: riderEmail, delivery_status: status })
    //         .sort({ creation_date: -1 })
    //         .toArray();

    //       res.send(parcels);
    //     } catch (error) {
    //       console.error("Error fetching pending parcels:", error); // Log the specific error on the server
    //       res.status(500).json({ message: "Internal Server Error" }); // Send a generic 500 to the client
    //     }
    //   }
    // );

    // // Update parcel to Parcel-picked and log it
    // app.patch(
    //   "/parcels/:id/start-delivery",
    //   verifyFirebaseToken,
    //   verifyRider,
    //   async (req, res) => {
    //     const { id } = req.params;
    //     const { riderName } = req.body;

    //     const update = {
    //       $set: { delivery_status: "Parcel-picked" },
    //       $push: {
    //         logs: {
    //           status: "Picked-up by Rider",
    //           timestamp: new Date(),
    //           note: "Parcel successfully delivered by rider",
    //         },
    //       },
    //     };

    //     const result = await parcelcollection.updateOne(
    //       { _id: new ObjectId(id) },
    //       update
    //     );
    //     res.send(result);
    //   }
    // );

    // //update data after delivery
    // app.patch(
    //   "/parcels/:id/mark-delivered",
    //   verifyFirebaseToken,
    //   verifyRider,
    //   async (req, res) => {
    //     const { id } = req.params;
    //     const riderEmail = req.query.email;

    //     const parcel = await parcelcollection.findOne({
    //       _id: new ObjectId(id),
    //     });

    //     if (!parcel) {
    //       return res.status(404).send({ error: "Parcel not found" });
    //     }

    //     const totalCost = parseFloat(parcel.cost || 0);
    //     const sameDistrict = parcel.senderDistrict === parcel.receiverDistrict;
    //     const calculatedEarning = sameDistrict
    //       ? totalCost * 0.8
    //       : totalCost * 0.3;

    //     // 1. Update parcel
    //     const updateParcel = await parcelcollection.updateOne(
    //       { _id: new ObjectId(id) },
    //       {
    //         $set: { delivery_status: "Delivered" },
    //         $push: {
    //           logs: {
    //             status: "Delivered",
    //             timestamp: new Date(),
    //             note: "Parcel successfully delivered by rider",
    //           },
    //         },
    //       }
    //     );

    //     // 2. Update rider earnings and total_earned
    //     const updateRider = await ridercollection.updateOne(
    //       { email: riderEmail },
    //       {
    //         $set: { work_status: "free" },
    //         $inc: {
    //           earnings: calculatedEarning, // current balance
    //           total_earned: calculatedEarning, // cumulative income
    //         },
    //       },
    //       { upsert: true }
    //     );

    //     res.send({
    //       message: "Parcel delivered and earnings added",
    //       parcelUpdate: updateParcel,
    //       riderEarningUpdate: updateRider,
    //     });
    //   }
    // );

    //completed parcel info
    // app.get(
    //   "/parcels/rider/completed",
    //   verifyFirebaseToken,
    //   verifyRider,
    //   async (req, res) => {
    //     try {
    //       const riderEmail = req.query.email;

    //       if (!riderEmail) {
    //         return res.status(400).send({ error: "Rider email is required" });
    //       }

    //       const deliveredParcels = await parcelcollection
    //         .find({
    //           assigned_rider_email: riderEmail,
    //           delivery_status: "Delivered",
    //         })
    //         .sort({ delivery_date: -1 }) // optional: if you store a delivery_date
    //         .toArray();

    //       res.send(deliveredParcels);
    //     } catch (err) {
    //       console.error("Error fetching completed deliveries:", err);
    //       res.status(500).send({ error: "Internal Server Error" });
    //     }
    //   }
    // );

    // //update parcel

    // app.put(
    //   "/parcels/assign/:id",
    //   verifyFirebaseToken,
    //   verifyAdmin,
    //   async (req, res) => {
    //     const parcelId = req.params.id;
    //     const { riderId, ridername, rider_email } = req.body;

    //     console.log(riderId, rider_email, ridername);

    //     if (!riderId) {
    //       return res.status(400).json({ error: "Missing riderId" });
    //     }

    //     try {
    //       const parcelObjectId = new ObjectId(parcelId);
    //       const riderObjectId = new ObjectId(String(riderId));

    //       // 1. Update the parcel's status and assign the rider
    //       const parcelUpdate = await parcelcollection.updateOne(
    //         { _id: parcelObjectId },
    //         {
    //           $set: {
    //             delivery_status: "Rider-assigned",
    //             assigned_rider: String(riderId),
    //             assigned_rider_name: ridername,
    //             assigned_rider_email: rider_email,
    //           },
    //           $push: {
    //             logs: {
    //               status: "Rider will pickedup parcel",
    //               timestamp: new Date(),
    //               note: "Rider assigned and parcel is now picking up",
    //             },
    //           },
    //         }
    //       );

    //       // 2. Update the rider's work status
    //       const riderUpdate = await ridercollection.updateOne(
    //         { _id: riderObjectId },
    //         {
    //           $set: {
    //             work_status: "in-delivery",
    //           },
    //         }
    //       );

    //       if (
    //         parcelUpdate.modifiedCount === 0 ||
    //         riderUpdate.modifiedCount === 0
    //       ) {
    //         return res
    //           .status(404)
    //           .json({ error: "Update failed. Parcel or rider not found." });
    //       }

    //       res.json({ message: "Rider assigned and statuses updated." });
    //     } catch (err) {
    //       console.error("Assign error:", err);
    //       res.status(500).json({ error: "Internal server error" });
    //     }
    //   }
    // );

    // Payment

    //payment data get

    app.get("/payments", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.email = email;
      }

      try {
        const payments = await paymentcollection
          .find(query)
          .sort({ paidAt: -1 }) // descending order (latest first)
          .toArray();

        res.send(payments);
      } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).send({ error: "Failed to fetch payment records" });
      }
    });

    //get payment by Id

    app.get(
      "/payments/:id",

      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await paymentcollection.findOne(query);
        res.send(result);
      }
    );

    //post payment info

    app.post("/payments", async (req, res) => {
      const {
        amount,
        currency,
        tracking_id,
        _id, // parcel id
        email,
        transactionId,
        paymentMethod,
        paidAt,
      } = req.body;

      try {
        // 1. Save payment info
        const paymentDoc = {
          amount,
          currency,
          _id,
          email,
          transactionId,
          paymentMethod,
          paidAt,
        };

        const insertResult = await paymentcollection.insertOne(paymentDoc);

        // 2. Update parcel to "paid" and add timeline log
        // const updateResult = await parcelcollection.updateOne(
        //   { _id: new ObjectId(String(_id)) },
        //   {
        //     $set: {
        //       payment_status: "paid",
        //     },
        //     $push: {
        //       logs: {
        //         status: "Paid",
        //         timestamp: new Date(paidAt),
        //         note: `Payment of ৳${amount} completed via ${paymentMethod}`,
        //       },
        //     },
        //   }
        // );

        res.send({
          message: "Payment recorded and parcel updated",
          paymentId: insertResult.insertedId,
          updated: updateResult.modifiedCount > 0,
        });
      } catch (error) {
        console.error("Payment error:", error);
        res.status(500).send({ error: "Failed to store payment info" });
      }
    });

    // //For track parcel
    // const trackingcollection = database.collection("trackings");

    // // post tracking
    // app.post("/trackings", async (req, res) => {
    //   const { tracking_id, status, location, updated_by } = req.body;

    //   const newTracking = {
    //     tracking_id,
    //     status,
    //     location,
    //     updated_by,
    //     timestamp: new Date().toISOString(),
    //   };

    //   const result = await trackingcollection.insertOne(newTracking);
    //   res.send(result);
    // });

    // //get tracking sorted
    // app.get("/trackings/:trackingId", async (req, res) => {
    //   try {
    //     const { trackingId } = req.params;

    //     const parcel = await parcelcollection.findOne({
    //       tracking_id: trackingId,
    //     });

    //     if (!parcel) {
    //       return res.status(404).send({ error: "Parcel not found" });
    //     }

    //     if (!parcel.logs || parcel.logs.length === 0) {
    //       return res.send([]);
    //     }

    //     // Sort logs by timestamp (optional)
    //     const sortedLogs = parcel.logs.sort(
    //       (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    //     );

    //     res.send(sortedLogs);
    //   } catch (error) {
    //     console.error("Tracking fetch error:", error);
    //     res.status(500).send({ error: "Internal server error" });
    //   }
    // });

    // //Rider servers

    // //post rider
    // app.post("/riders", async (req, res) => {
    //   const rider = req.body;
    //   const result = await ridercollection.insertOne(rider);
    //   res.send(result);
    // });

    // //get rider by its district
    // app.get("/riders", async (req, res) => {
    //   try {
    //     const { district } = req.query;

    //     if (!district) {
    //       return res.status(400).json({ error: "District is required" });
    //     }

    //     const acceptedRiders = await ridercollection
    //       .find({
    //         status: "accepted",
    //         district: district, // Use this if your field is named 'district'
    //       })
    //       .toArray();

    //     res.status(200).json(acceptedRiders);
    //   } catch (error) {
    //     console.error("Error fetching accepted riders:", error);
    //     res.status(500).json({ error: "Internal Server Error" });
    //   }
    // });

    // //pending rider info get

    // app.get(
    //   "/riders/pending",
    //   verifyFirebaseToken,
    //   verifyAdmin,
    //   async (req, res) => {
    //     const pendingRiders = await ridercollection
    //       .find({ status: "pending" })
    //       .toArray();
    //     res.send(pendingRiders);
    //   }
    // );

    // //get active rider
    // app.get(
    //   "/riders/accepted",
    //   verifyFirebaseToken,
    //   verifyAdmin,
    //   async (req, res) => {
    //     const activeRiders = await ridercollection
    //       .find({ status: "accepted" })
    //       .toArray();
    //     res.send(activeRiders);
    //   }
    // );

    // // Update rider status (Accept/Reject)
    // app.patch("/riders/:id/status", async (req, res) => {
    //   const { status } = req.body;
    //   //update role in the user

    //   if (status === "accepted") {
    //   }
    //   const email = req.body.email;
    //   const query = { email };

    //   const updateResult = await userscollection.updateOne(query, {
    //     $set: { role: "rider" },
    //   });

    //   const { id } = req.params;

    //   const result = await ridercollection.updateOne(
    //     { _id: new ObjectId(id) },
    //     { $set: { status } }
    //   );
    //   res.send(result, updateResult);
    // });

    // //particular rider profile

    // app.get("/riders/profile", async (req, res) => {
    //   const email = req.query.email;
    //   if (!email) {
    //     return res.status(400).send({ error: "Email is required" });
    //   }

    //   try {
    //     const rider = await ridercollection.findOne({ email });
    //     if (!rider) {
    //       return res.status(404).send({ error: "Rider not found" });
    //     }

    //     res.send(rider);
    //   } catch (error) {
    //     console.error("Error fetching rider profile:", error);
    //     res.status(500).send({ error: "Internal Server Error" });
    //   }
    // });
    // //rider cashout
    // app.patch(
    //   "/riders/cashout",
    //   verifyFirebaseToken,
    //   verifyRider,
    //   async (req, res) => {
    //     const { email } = req.body;

    //     if (!email) return res.status(400).send({ error: "Email is required" });

    //     try {
    //       const rider = await ridercollection.findOne({ email });

    //       if (!rider || rider.earnings <= 0) {
    //         return res
    //           .status(400)
    //           .send({ error: "No earnings available to cash out." });
    //       }

    //       const cashoutAmount = rider.earnings;

    //       const log = {
    //         amount: cashoutAmount,
    //         date: new Date(),
    //         type: "cashout",
    //       };

    //       const update = await ridercollection.updateOne(
    //         { email },
    //         {
    //           $set: { earnings: 0 },
    //           $inc: { total_cashout: cashoutAmount }, // ✅ track cashout history
    //           $push: { cashout_history: log },
    //         }
    //       );

    //       res.send({ message: "Cashout successful", cashout: log });
    //     } catch (error) {
    //       console.error("Cashout error:", error);
    //       res.status(500).send({ error: "Internal server error" });
    //     }
    //   }
    // );

    // //rider summary
    // app.get(
    //   "/riders/summary",
    //   verifyFirebaseToken,
    //   verifyRider,
    //   async (req, res) => {
    //     const { email } = req.query;
    //     if (!email) return res.status(400).send({ error: "Email required" });

    //     const rider = await ridercollection.findOne(
    //       { email },
    //       { projection: { total_earned: 1, total_cashout: 1, earnings: 1 } }
    //     );

    //     if (!rider) return res.status(404).send({ error: "Rider not found" });

    //     res.send({
    //       totalEarned: rider.total_earned || 0,
    //       totalCashout: rider.total_cashout || 0,
    //       currentBalance: rider.earnings || 0,
    //     });
    //   }
    // );

    //all data about this database
    // app.get("/admin/overview", async (req, res) => {
    //   try {
    //     const result = await parcelcollection
    //       .aggregate([
    //         {
    //           $facet: {
    //             totalParcels: [{ $count: "count" }],
    //             completedDeliveries: [
    //               { $match: { delivery_status: "Delivered" } },
    //               { $count: "count" },
    //             ],
    //           },
    //         },
    //         {
    //           $addFields: {
    //             totalParcels: { $arrayElemAt: ["$totalParcels.count", 0] },
    //             completedDeliveries: {
    //               $arrayElemAt: ["$completedDeliveries.count", 0],
    //             },
    //           },
    //         },
    //       ])
    //       .toArray();

    //     const parcelStats = result[0];

    //     const [totalUsers, totalRiders, pendingRiders] = await Promise.all([
    //       userscollection.countDocuments({ role: "user" }),
    //       userscollection.countDocuments({ role: "rider" }),
    //       ridercollection.countDocuments({ status: "pending" }),
    //     ]);

    //     res.json({
    //       totalParcels: parcelStats.totalParcels || 0,
    //       completedDeliveries: parcelStats.completedDeliveries || 0,
    //       totalUsers,
    //       totalRiders,
    //       pendingRiders,
    //     });
    //   } catch (error) {
    //     console.error("Aggregation error:", error);
    //     res.status(500).json({ error: "Internal Server Error" });
    //   }
    // });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// pass- VkVrFgAZxtEsA5I9  simpleDbUser

app.get("/", (req, res) => {
  res.send("parcelpilot server is running100");
});

app.listen(port, () => {
  console.log(`running server in ${port} port`);
});
