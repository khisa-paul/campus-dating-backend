// backend/server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all origins
app.use(cors());

// Middleware to parse JSON requests
app.use(express.json());

// Folder containing your JSON files
const jsonFolder = __dirname;

// Helper functions
const readJsonFile = (filePath) => {
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return {};
};

const writeJsonFile = (filePath, data) => {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
};

// Merge objects (for updates)
const mergeObjects = (target, source) => {
  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      target[key] = source[key];
    }
  }
  return target;
};

// Auto-generate CRUD endpoints for all JSON files
fs.readdirSync(jsonFolder).forEach(file => {
  if (path.extname(file) === '.json') {
    const route = `/api/${path.basename(file, '.json')}`;
    const filePath = path.join(jsonFolder, file);

    // GET endpoint: read file
    app.get(route, (req, res) => {
      try {
        const data = readJsonFile(filePath);
        res.json(data);
      } catch (err) {
        res.status(500).json({ error: 'Failed to read file', details: err.message });
      }
    });

    // POST endpoint: update/add keys
    app.post(route, (req, res) => {
      try {
        const currentData = readJsonFile(filePath);
        const updatedData = mergeObjects(currentData, req.body);
        writeJsonFile(filePath, updatedData);
        res.json({ message: `${file} updated successfully`, data: updatedData });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update file', details: err.message });
      }
    });

    // DELETE endpoint: remove keys
    app.delete(route, (req, res) => {
      try {
        const currentData = readJsonFile(filePath);
        const keysToDelete = req.body.keys || [];
        keysToDelete.forEach(key => delete currentData[key]);
        writeJsonFile(filePath, currentData);
        res.json({ message: `${file} keys deleted successfully`, data: currentData });
      } catch (err) {
        res.status(500).json({ error: 'Failed to delete keys', details: err.message });
      }
    });
  }
});

// Root route
app.get('/', (req, res) => {
  res.send('Campus Dating Backend is running!');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
