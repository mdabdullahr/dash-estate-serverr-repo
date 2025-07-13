require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jsryxpo.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const usersCollection = client.db("real_estate_DB").collection("users");
    const propertiesCollection = client
      .db("real_estate_DB")
      .collection("properties");
    const wishlistCollection = client
      .db("real_estate_DB")
      .collection("wishlists");
    const reviewsCollection = client.db("real_estate_DB").collection("reviews");
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    // * USERS COllections Related API

    // Role based api
    app.get("/users/:email/role", async (req, res) => {
      try {
        const email = req.params.email;

        if (!email) {
          return res.status(400).send({ message: "email is required" });
        }
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res
            .status(404)
            .send({ message: "User not found", role: null });
        }
        res.send({ role: user.role || "user" });
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const existing = await usersCollection.findOne({ email: user.email });
      if (existing) {
        return res.send({ message: "User already exists" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // * AGENT COLLECTION RELATED API
    // Add Property API
    app.post("/properties", async (req, res) => {
      const property = req.body;
      const result = await propertiesCollection.insertOne(property);
      res.send(result);
    });

    // GET agent's own added properties
    app.get("/properties/agent/:email", async (req, res) => {
      const email = req.params.email;
      const result = await propertiesCollection
        .find({ agentEmail: email })
        .toArray();
      res.send(result);
    });

    // PATCH: Update property by ID
    app.patch("/properties/:id", async (req, res) => {
      const { id } = req.params;
      const updateData = req.body;

      try {
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            title: updateData.title,
            location: updateData.location,
            image: updateData.image,
            minPrice: updateData.minPrice,
            maxPrice: updateData.maxPrice,
            description: updateData.propertyDetails,
          },
        };

        const result = await propertiesCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Update failed:", error.message);
        res.status(500).send({ error: "Failed to update property" });
      }
    });

    // DELETE a property by ID
    app.delete("/properties/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await propertiesCollection.deleteOne(query);
      res.send(result);
    });

    //* ADMIN RELATED API
    // GET all properties for admin
    app.get("/admin/properties", async (req, res) => {
      const result = await propertiesCollection.find().toArray();
      res.send(result);
    });

    // PATCH verify
    app.patch("/admin/properties/verify/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const update = { $set: { verificationStatus: "verified" } };
      const result = await propertiesCollection.updateOne(filter, update);
      res.send(result);
    });

    // PATCH reject
    app.patch("/admin/properties/reject/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const update = { $set: { verificationStatus: "rejected" } };
      const result = await propertiesCollection.updateOne(filter, update);
      res.send(result);
    });

    //* ALL PROPERTIES RELATED API
    // GET all verified properties
    app.get("/properties/verified", async (req, res) => {
      const verifiedProperties = await propertiesCollection
        .find({ verificationStatus: "verified" })
        .toArray();
      res.send(verifiedProperties);
    });

    // GET specific property by id
    app.get("/properties/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const property = await propertiesCollection.findOne(query);
      res.send(property);
    });

    // GET: Check if property is already in wishlist
    app.get("/wishlists/check", async (req, res) => {
      const { userEmail, propertyId } = req.query;

      const exists = await wishlistCollection.findOne({
        userEmail,
        propertyId,
      });
      res.send({ alreadyWishlisted: !!exists });
    });

    // POST: Add to Wishlist (Prevent Duplicate)
    app.post("/wishlists", async (req, res) => {
      const wishlistData = req.body;

      const exists = await wishlistCollection.findOne({
        userEmail: wishlistData.userEmail,
        propertyId: wishlistData.propertyId,
      });

      if (exists) {
        return res.send({ acknowledged: false, message: "Already wishlisted" });
      }

      const result = await wishlistCollection.insertOne(wishlistData);
      res.send(result);
    });

    // GET review by id
    app.get("/reviews/:propertyId", async (req, res) => {
      const propertyId = req.params.propertyId;
      const query = { propertyId };
      const reviews = await reviewsCollection.find(query).toArray();
      res.send(reviews);
    });

    // POST all reviews
    app.post("/reviews", async (req, res) => {
      const review = req.body;
      const result = await reviewsCollection.insertOne(review);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Test Route
app.get("/", (req, res) => {
  res.send("Express server is running 🚀");
});

// Start server
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
