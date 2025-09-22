// backend/server.js
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());
app.use(express.json());

// Connect to MongoDB
const mongoUri = process.env.MONGO_URL;
if (!mongoUri) {
  console.error('Error: MONGO_URL environment variable not set.');
  process.exit(1);
}

mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected!'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Dynamic Mongoose model cache
const models = {};

// Helper function to get/create a model for a collection
function getModel(collectionName) {
  if (models[collectionName]) return models[collectionName];

  const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
  const model = mongoose.model(collectionName, schema, collectionName);
  models[collectionName] = model;
  return model;
}

// Dynamic CRUD endpoints
app.get('/api/:collection', async (req, res) => {
  const { collection } = req.params;
  const Model = getModel(collection);

  try {
    const data = await Model.find({});
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch data', details: err.message });
  }
});

app.post('/api/:collection', async (req, res) => {
  const { collection } = req.params;
  const Model = getModel(collection);

  try {
    const doc = new Model(req.body);
    await doc.save();
    res.json({ message: 'Document saved successfully', data: doc });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save document', details: err.message });
  }
});

app.delete('/api/:collection', async (req, res) => {
  const { collection } = req.params;
  const Model = getModel(collection);
  const { _id, filter } = req.body; // either _id or filter to delete multiple

  try {
    let result;
    if (_id) {
      result = await Model.findByIdAndDelete(_id);
    } else if (filter) {
      result = await Model.deleteMany(filter);
    } else {
      return res.status(400).json({ error: 'Provide either _id or filter to delete' });
    }
    res.json({ message: 'Document(s) deleted successfully', result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete document(s)', details: err.message });
  }
});

// Root route
app.get('/', (req, res) => {
  res.send('Campus Dating Backend with MongoDB is running!');
});

// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
