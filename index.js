require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const serviceAccount = require("./real-estate-admin-service-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jsryxpo.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// * All CUstom Middleware

// Verify JWT Access Token
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send("Unauthorized");

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send("Forbidden");
    req.decoded = decoded;
    // console.log(decoded);
    next();
  });
};

// Verify Token Email
const verifyTokenEmail = (req, res, next) => {
  const decodedEmail = req.decoded?.email;

  // Extract email from possible locations
  const paramEmail = req.params?.email;
  const queryEmail = req.query?.email;
  const bodyEmail = req.body?.email;

  // Allow if any of them match the decoded email
  if (
    decodedEmail === paramEmail ||
    decodedEmail === queryEmail ||
    decodedEmail === bodyEmail
  ) {
    return next();
  }

  return res.status(403).send({ message: "Forbidden access: Email mismatch" });
};

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

    //* Role Validation verifications
    // Verify Admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // Verify Agent
    const verifyAgent = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "agent") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // Verify User
    const verifyUser = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "user") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // *JWT APIs
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "7d" });
      res.send({ token });
    });

    // Home Page advertise fetch
    app.get("/properties/advertised", async (req, res) => {
      const properties = await propertiesCollection
        .find({ advertised: true })
        .toArray();
      res.send(properties);
    });

    // Home Page latest review
    // GET: /reviews/latest
    app.get("/reviews/latest", async (req, res) => {
      try {
        const latestReviews = await reviewsCollection
          .find()
          .sort({ postedAt: -1 })
          .limit(3)
          .toArray();

        res.send(latestReviews);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch latest reviews" });
      }
    });

    // * USERS COllections Related API

    // Role based api
    app.get(
      "/users/:email/role",
      verifyJWT,

      async (req, res) => {
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
      }
    );

    // Get specific property status for button disabled
    app.get("/offers/:id/bought-status", verifyJWT, async (req, res) => {
      try {
        const id = req.params.id;
        console.log("id from this status", id);
        if (!id) {
          return res.status(404).send({ message: "id is required" });
        }
        const offer = await offersCollection.findOne({ propertyId: id });
        if (!offer) {
          return res.status(404).send({ message: "offer not found" });
        }
        res.send({ boughtStatus: offer.status });
      } catch (error) {
        res.status(500).send({ message: "internal server error" });
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
    app.post("/properties", verifyJWT, verifyAgent, async (req, res) => {
      const property = req.body;
      const result = await propertiesCollection.insertOne(property);
      res.send(result);
    });

    // GET agent's own added properties
    app.get(
      "/properties/agent/:email",
      verifyJWT,
      verifyAgent,
      verifyTokenEmail,
      async (req, res) => {
        const email = req.params.email;
        // if (req.decoded.email === email) {
        //   return res.status(403).send({ message: "Unauthorized access" });
        // }
        const result = await propertiesCollection
          .find({ agentEmail: email })
          .sort({ timestamp: -1 })
          .toArray();
        res.send(result);
      }
    );

    // Get all offers for properties added by this agent
    app.get(
      "/agent-requests",
      verifyJWT,
      verifyAgent,
      verifyTokenEmail,
      async (req, res) => {
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
      }
    );

    // Agent Sold Property get api
    app.get(
      "/sold-properties",
      verifyJWT,
      verifyAgent,
      verifyTokenEmail,
      async (req, res) => {
        const email = req.query.email;
        if (!email) {
          return res.status(400).send({ error: "Agent email required" });
        }

        try {
          const sold = await offersCollection
            .find({ agentEmail: email, status: "bought" })
            .sort({ paidAt: -1 })
            .toArray();

          res.send(sold);
        } catch (error) {
          res.status(500).send({ error: "Failed to fetch sold properties" });
        }
      }
    );

    // GET total sold amount for an agent
    app.get(
      "/sold/total-amount",
      verifyJWT,
      verifyAgent,
      verifyTokenEmail,
      async (req, res) => {
        const { email } = req.query;
        if (!email) return res.status(400).send({ error: "Email is required" });

        try {
          const sold = await offersCollection
            .aggregate([
              {
                $match: {
                  agentEmail: email,
                  status: "bought",
                },
              },
              {
                $group: {
                  _id: null,
                  total: { $sum: "$offerAmount" },
                },
              },
            ])
            .toArray();

          const totalAmount = sold[0]?.total || 0;
          res.send({ totalAmount });
        } catch (err) {
          res
            .status(500)
            .send({ error: "Failed to calculate total sold amount" });
        }
      }
    );

    // Accept one offer, reject others for same property
    app.patch(
      "/offers/accept/:id",
      verifyJWT,
      verifyAgent,
      async (req, res) => {
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
      }
    );

    // PATCH: Update property by ID
    app.patch("/properties/:id", verifyJWT, verifyAgent, async (req, res) => {
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
    app.patch(
      "/offers/reject/:id",
      verifyJWT,
      verifyAgent,
      async (req, res) => {
        const id = req.params.id;

        const result = await offersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "rejected" } }
        );

        res.send(result);
      }
    );

    // DELETE a property by ID
    app.delete("/properties/:id", verifyJWT, verifyAgent, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await propertiesCollection.deleteOne(query);
      res.send(result);
    });

    //* ADMIN RELATED API
    // GET all properties for admin
    app.get("/admin/properties", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await propertiesCollection
        .find()
        .sort({ timestamp: -1 })
        .toArray();
      res.send(result);
    });

    // Get All Users
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const users = await usersCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.send(users);
    });

    // Get all reviews Admin(ManageReviews) page
    // GET /reviews
    app.get("/allReviews", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const reviews = await reviewsCollection
          .find()
          .sort({ postedAt: -1 })
          .toArray();

        res.send(reviews);
      } catch (error) {
        console.error("Error fetching reviews:", error);
        res.status(500).send({ error: "Failed to fetch reviews" });
      }
    });

    // Get all verified (non-advertised) properties for admin:
    app.get(
      "/properties/verified/admin",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const properties = await propertiesCollection
          .find({ verificationStatus: "verified" })
          .sort({ timestamp: -1 })
          .toArray();
        res.send(properties);
      }
    );

    // Make property Advertised
    app.patch(
      "/properties/advertise/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const result = await propertiesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { advertised: true } }
        );
        res.send(result);
      }
    );

    // Make admin api
    app.patch("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role: "admin" } }
      );
      res.send(result);
    });

    // Make agent api
    app.patch("/users/agent/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role: "agent" } }
      );
      res.send(result);
    });

    // Mark as fraud api
    app.patch("/users/fraud/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const user = await usersCollection.findOne({ _id: new ObjectId(id) });

      if (!user || user.role !== "agent") {
        return res.status(400).send("Only agents can be marked as fraud");
      }

      // 1. Update user status to fraud
      await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "fraud" } }
      );

      // 2. Remove or unverify agent's properties
      await propertiesCollection.updateMany(
        { agentEmail: user.email },
        { $set: { verificationStatus: "rejected" } } // Or delete them if required
      );

      res.send({ message: "User marked as fraud and properties hidden" });
    });

    // Delete user from database and also firebase
    app.delete("/users/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const user = await usersCollection.findOne({ _id: new ObjectId(id) });

      if (!user) return res.status(404).send("User not found");

      try {
        await admin.auth().deleteUser(user.firebaseUid);

        const result = await usersCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send({
          message: "User deleted from both Firebase and MongoDB",
          result,
        });
      } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).send({ message: "Failed to delete user", error });
      }
    });

    // PATCH verify
    app.patch(
      "/admin/properties/verify/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const update = { $set: { verificationStatus: "verified" } };
        const result = await propertiesCollection.updateOne(filter, update);
        res.send(result);
      }
    );

    // PATCH reject
    app.patch(
      "/admin/properties/reject/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const update = { $set: { verificationStatus: "rejected" } };
        const result = await propertiesCollection.updateOne(filter, update);
        res.send(result);
      }
    );

    // DELETE /reviews/:id admin ManageReviews page
    app.delete("/reviews/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;

      try {
        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount > 0) {
          res.send({ message: "Review deleted successfully", deletedCount: 1 });
        } else {
          res.status(404).send({ error: "Review not found" });
        }
      } catch (error) {
        console.error("Error deleting review:", error);
        res.status(500).send({ error: "Failed to delete review" });
      }
    });

    //* ALL PROPERTIES RELATED API
    // GET all verified properties with sort, search functionality
    app.get("/properties/verified", verifyJWT, async (req, res) => {
      const { search = "", sort = "" } = req.query;

      const query = {
        verificationStatus: "verified",
        location: { $regex: search, $options: "i" },
      };

      const allProperties = await propertiesCollection.find(query).toArray();

      // Calculate averagePrice and sort
      const propertiesWithAvg = allProperties.map((p) => ({
        ...p,
        averagePrice: (p.minPrice + p.maxPrice) / 2,
      }));

      const sorted =
        sort === "asc"
          ? propertiesWithAvg.sort((a, b) => a.averagePrice - b.averagePrice)
          : sort === "desc"
          ? propertiesWithAvg.sort((a, b) => b.averagePrice - a.averagePrice)
          : propertiesWithAvg;

      res.send(sorted);
    });

    // GET specific property by id
    app.get("/properties/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const property = await propertiesCollection.findOne(query);
      res.send(property);
    });

    // GET: Check if property is already in wishlist
    app.get("/wishlists/check", verifyJWT, async (req, res) => {
      const { userEmail, propertyId } = req.query;

      const exists = await wishlistCollection.findOne({
        userEmail,
        propertyId,
      });
      res.send({ alreadyWishlisted: !!exists });
    });

    // POST: Add to Wishlist (Prevent Duplicate)
    app.post("/wishlists", verifyJWT, async (req, res) => {
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
    app.get("/reviews/:propertyId", verifyJWT, async (req, res) => {
      const propertyId = req.params.propertyId;
      const query = { propertyId };
      const reviews = await reviewsCollection.find(query).toArray();
      res.send(reviews);
    });

    // GET review by specific user created
    app.get(
      "/reviews",
      verifyJWT,
      verifyUser,
      verifyTokenEmail,
      async (req, res) => {
        const email = req.query.email;
        if (!email) return res.status(400).send({ error: "Email is required" });

        const result = await reviewsCollection
          .find({ userEmail: email })
          .sort({ postedAt: -1 })
          .toArray();
        res.send(result);
      }
    );

    // POST all reviews
    app.post("/reviews", verifyJWT, async (req, res) => {
      const review = req.body;
      const result = await reviewsCollection.insertOne(review);
      res.send(result);
    });

    // Delete reviews by specific user created
    app.delete("/user-reviews/:id", verifyJWT, verifyUser, async (req, res) => {
      const id = req.params.id;
      const result = await reviewsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // Get All User Specific wishlist by query email
    app.get(
      "/wishlists",
      verifyJWT,
      verifyTokenEmail,
      verifyUser,
      async (req, res) => {
        const userEmail = req.query.email;
        if (!userEmail) return res.status(400).send("Missing email");

        const wishlists = await wishlistCollection
          .find({ userEmail })
          .toArray();
        res.send(wishlists);
      }
    );

    // Get specific wishlist for offer by user
    app.get("/wishlists/:id", verifyJWT, verifyUser, async (req, res) => {
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
    app.delete("/wishlists/:id", verifyJWT, verifyUser, async (req, res) => {
      const id = req.params.id;
      const result = await wishlistCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // Get offered property by user email
    app.get(
      "/offers",
      verifyJWT,
      verifyTokenEmail,
      verifyUser,
      async (req, res) => {
        const { email } = req.query;
        if (!email) return res.status(400).send("Email is required");

        const result = await offersCollection
          .find({ buyerEmail: email })
          .toArray();
        res.send(result);
      }
    );

    // Called the api from payment page by single data
    app.get("/offers/:id", verifyJWT, verifyUser, async (req, res) => {
      const id = req.params.id;
      const result = await offersCollection.findOne({ _id: new ObjectId(id) });
      if (!result) {
        return res.status(404).send({ message: "Offer not found" });
      }
      res.send(result);
    });

    // Submit an offer with validation by user
    app.post("/offers", verifyJWT, verifyUser, async (req, res) => {
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
      if (
        !propertyId ||
        !buyerEmail ||
        !offerAmount ||
        !buyingDate ||
        !agentEmail
      ) {
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
    app.patch(
      "/offers/payment/:id",
      verifyJWT,
      verifyUser,
      async (req, res) => {
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
      }
    );

    // * Create Payment Intent Api
    // Inside your Express app
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
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

    //* GET: /api/dashboard-summary?email=...
    app.get(
      "/api/dashboard-summary",
      verifyJWT,
      verifyTokenEmail,
      async (req, res) => {
        const email = req.query.email;
        if (!email)
          return res.status(400).json({ message: "Email is required" });

        try {
          const user = await usersCollection.findOne({ email });

          if (!user) return res.status(404).json({ message: "User not found" });

          const role = user.role;
          const result = { role };

          // 🧑 User Role Dashboard Summary
          if (role === "user") {
            const wishlistCount = await wishlistCollection.countDocuments({
              userEmail: email,
            });
            const boughtCount = await offersCollection.countDocuments({
              buyerEmail: email,
              status: "bought",
            });
            const reviewCount = await reviewsCollection.countDocuments({
              userEmail: email,
            });

            const recentWishlist = await wishlistCollection
              .find({ userEmail: email })
              .sort({ addedAt: -1 })
              .limit(3)
              .toArray();

            const recentReviews = await reviewsCollection
              .find({ userEmail: email })
              .sort({ postedAt: -1 })
              .limit(2)
              .toArray();

            const chartData = [
              { name: "Wishlist", value: wishlistCount },
              { name: "Bought", value: boughtCount },
              { name: "Reviews", value: reviewCount },
            ];

            result.wishlistCount = wishlistCount;
            result.boughtCount = boughtCount;
            result.reviewCount = reviewCount;
            result.recentWishlist = recentWishlist;
            result.recentReviews = recentReviews;
            result.chartData = chartData;
          }

          // 🧑‍💼 Agent Role Dashboard Summary
          if (role === "agent") {
            const recentProperties = await propertiesCollection
              .find({ agentEmail: email })
              .sort({ timestamp: -1 })
              .limit(3)
              .toArray();

            const recentOffers = await offersCollection
              .find({ agentEmail: email })
              .sort({ createdAt: -1 })
              .limit(3)
              .toArray();

            const totalProperties = await propertiesCollection.countDocuments({
              agentEmail: email,
            });

            const soldOffers = await offersCollection
              .find({ agentEmail: email, status: "bought" })
              .toArray();

            const soldCount = soldOffers.length;

            const soldAmount = soldOffers.reduce(
              (sum, offer) => sum + parseFloat(offer.offerAmount || 0),
              0
            );

            const requestedCount = await offersCollection.countDocuments({
              agentEmail: email,
            });

            const availableCount = totalProperties - soldCount;

            const pieChartData = [
              { name: "Sold", value: soldCount },
              { name: "Requested", value: requestedCount },
              {
                name: "Available",
                value: availableCount < 0 ? 0 : availableCount,
              },
            ];

            // ✅ Add these to the result object
            result.addedProperties = totalProperties;
            result.requestedCount = requestedCount;
            result.soldCount = soldCount;
            result.soldAmount = soldAmount;

            result.recentProperties = recentProperties;
            result.recentOffers = recentOffers;
            result.pieChartData = pieChartData;
          }

          // 👨‍💼 Admin Role Dashboard Summary
          if (role === "admin") {
            const totalUsers = await usersCollection.countDocuments();
            const totalProperties = await propertiesCollection.countDocuments();
            const totalReviews = await reviewsCollection.countDocuments();

            const recentUsers = await usersCollection
              .find()
              .sort({ createdAt: -1 })
              .limit(3)
              .toArray();

            const recentProperties = await propertiesCollection
              .find()
              .sort({ timestamp: -1 })
              .limit(3)
              .toArray();

            const recentReviews = await reviewsCollection
              .find()
              .sort({ postedAt: -1 })
              .limit(3)
              .toArray();

            // (Optional) chart: verified vs pending properties
            const verifiedCount = await propertiesCollection.countDocuments({
              verificationStatus: "verified",
            });
            const pendingCount = await propertiesCollection.countDocuments({
              verificationStatus: "pending",
            });

            const propertyStatusChart = [
              { name: "Verified", value: verifiedCount },
              { name: "Pending", value: pendingCount },
            ];

            result.totalUsers = totalUsers;
            result.totalProperties = totalProperties;
            result.totalReviews = totalReviews;

            result.recentUsers = recentUsers;
            result.recentProperties = recentProperties;
            result.recentReviews = recentReviews;

            result.propertyStatusChart = propertyStatusChart; // Optional chart
          }

          res.json(result);
        } catch (err) {
          console.error("Dashboard error:", err);
          res.status(500).json({ message: "Internal server error" });
        }
      }
    );

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
