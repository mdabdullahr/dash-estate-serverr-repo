require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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
    const offersCollection = client.db("real_estate_DB").collection("offers");
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    // * USERS COllections Related API

    // app.get("/offers/:id/bought-status", async (req, res) => {
    //   try{
    //     const id = req.params.id;
    //     console.log( "id from this status",id);
    //     if(!id){
    //       return res.status(404).send({message: "id is required"});
    //     }
    //     const offer = await offersCollection.findOne({propertyId : id})
    //     if(!offer){
    //       return res.status(404).send({message: "offer not found"})
    //     }
    //     res.send({boughtStatus : offer.status});
    //   }catch (error){
    //     res.status(500).send({message: "internal server error"})
    //   }
    // });

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

    // Get all offers for properties added by this agent
    app.get("/agent-requests", async (req, res) => {
      const { email } = req.query;
      if (!email) return res.status(400).send("Email is required");

      // First, get agent's properties
      const properties = await propertiesCollection
        .find({ agentEmail: email })
        .toArray();
      const propertyIds = properties.map((p) => p._id.toString());

      // Then, get offers for those properties
      const offers = await offersCollection
        .find({ propertyId: { $in: propertyIds } })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(offers);
    });

    // Agent Sold Property get api
    app.get("/sold-properties", async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ error: "Agent email required" });
      }

      try {
        const sold = await offersCollection
          .find({ agentEmail: email, status: "bought" })
          .sort({paidAt : -1})
          .toArray();

        res.send(sold);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch sold properties" });
      }
    });

    // Accept one offer, reject others for same property
    app.patch("/offers/accept/:id", async (req, res) => {
      const id = req.params.id;
      const offer = await offersCollection.findOne({ _id: new ObjectId(id) });

      if (!offer) return res.status(404).send("Offer not found");

      // 1. Accept selected offer
      await offersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "accepted" } }
      );

      // 2. Reject others for same property
      await offersCollection.updateMany(
        {
          propertyId: offer.propertyId,
          _id: { $ne: new ObjectId(id) },
        },
        { $set: { status: "rejected" } }
      );

      res.send({ message: "Offer accepted and others rejected." });
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

    // Reject a specific offer
    app.patch("/offers/reject/:id", async (req, res) => {
      const id = req.params.id;

      const result = await offersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "rejected" } }
      );

      res.send(result);
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

    // GET review by specific user created
    app.get("/reviews", async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ error: "Email is required" });

      const result = await reviewsCollection
        .find({ userEmail: email })
        .sort({ postedAt: -1 })
        .toArray();
      res.send(result);
    });

    // POST all reviews
    app.post("/reviews", async (req, res) => {
      const review = req.body;
      const result = await reviewsCollection.insertOne(review);
      res.send(result);
    });

    // Delete reviews by specific user created
    app.delete("/reviews/:id", async (req, res) => {
      const id = req.params.id;
      const result = await reviewsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // Get All User Specific wishlist by query email
    app.get("/wishlists", async (req, res) => {
      const userEmail = req.query.email;
      if (!userEmail) return res.status(400).send("Missing email");

      const wishlists = await wishlistCollection.find({ userEmail }).toArray();
      res.send(wishlists);
    });

    // Get specific wishlist for offer by user
    app.get("/wishlists/:id", async (req, res) => {
      const id = req.params.id;
      const wishlist = await wishlistCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!wishlist) {
        return res.status(404).send({ message: "Wishlist not found" });
      }

      res.send(wishlist);
    });

    // Delete A wishlist items by user
    app.delete("/wishlists/:id", async (req, res) => {
      const id = req.params.id;
      const result = await wishlistCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // Get offered property by user email
    app.get("/offers", async (req, res) => {
      const { email } = req.query;
      if (!email) return res.status(400).send("Email is required");

      const result = await offersCollection
        .find({ buyerEmail: email })
        .toArray();
      res.send(result);
    });

    // Called the api from payment page by single data
    app.get("/offers/:id", async (req, res) => {
      const id = req.params.id;
      const result = await offersCollection.findOne({ _id: new ObjectId(id) });
      if (!result) {
        return res.status(404).send({ message: "Offer not found" });
      }
      res.send(result);
    });

    // Submit an offer with validation by user
    app.post("/offers", async (req, res) => {
      const offerData = req.body;
      const {
        propertyId,
        propertyTitle,
        propertyLocation,
        propertyImage,
        agentName,
        agentEmail,
        buyerEmail,
        buyerName,
        offerAmount,
        buyingDate,
        minPrice,
        maxPrice,
        wishlistId,
      } = offerData;

      // Validate required fields
      if (!propertyId || !buyerEmail || !offerAmount || !buyingDate || !agentEmail) {
        return res.status(400).send({ message: "Missing required fields" });
      }

      // Optional: Validate user role
      const buyer = await usersCollection.findOne({ email: buyerEmail });
      if (!buyer || buyer.role !== "user") {
        return res
          .status(403)
          .send({ message: "Only users can submit offers" });
      }

      // Validate price range
      if (offerAmount < minPrice || offerAmount > maxPrice) {
        return res
          .status(400)
          .send({ message: "Offer must be within price range" });
      }

      const newOffer = {
        propertyId,
        propertyTitle,
        propertyLocation,
        propertyImage,
        agentName,
        agentEmail,
        buyerEmail,
        buyerName,
        offerAmount,
        buyingDate,
        status: "pending",
        createdAt: new Date(),
      };

      const result = await offersCollection.insertOne(newOffer);

      // Optional: Remove wishlist item after offer
      if (wishlistId) {
        await wishlistCollection.deleteOne({ _id: new ObjectId(wishlistId) });
      }

      res.send(result);
    });

    // Update offer after payment
    app.patch("/offers/payment/:id", async (req, res) => {
      const { id } = req.params;
      const { transactionId, status, paidAt } = req.body;

      const result = await offersCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status,
            transactionId,
            paidAt,
          },
        }
      );

      res.send(result);
    });

    // * Create Payment Intent Api
    // Inside your Express app
    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;
      // console.log("amount from payment intent",amount);
      // ✅ Basic validation
      if (!amount || typeof amount !== "number" || amount <= 0) {
        return res.status(400).send({ error: "Invalid price" });
      }

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100, // Stripe expects amount in cents
          currency: "usd",
          payment_method_types: ["card"],
        });
        // console.log(paymentIntent.client_secret);
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error("Stripe error:", error);
        res.status(500).send({ error: error.message });
      }
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
