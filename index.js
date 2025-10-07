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
  }
});



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

    console.log()
    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    const database = client.db("DailyScope");
    // const articlecollection = database.collection("articles");
    const paymentcollection = database.collection("payments");
    const userscollection = database.collection("users");

   
    //users
    //post user

    app.post("/users", async (req, res) => {
      const { name, email, role, created_At, last_log_in } = req.body;

      console.log(req.body);

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
        email,
        transactionId,
        paymentMethod,
        paidAt,
        subscribe,
        premiumExpiresAt,
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

        // 2. Update user to "paid" and add timeline log
        const result = await userscollection.updateOne(
          { email },
          {
            $set: {
              subscribe,
              premiumExpiresAt,
            },
          }
        );

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

  
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// pass- VkVrFgAZxtEsA5I9  simpleDbUser

app.get("/", (req, res) => {
  res.send("Dailyscope server is running100");
});

app.listen(port, () => {
  console.log(`running server in ${port} port`);
});
