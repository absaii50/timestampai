const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the artifacts/ai-timestamp/dist/public directory
app.use(express.static(path.join(__dirname, 'artifacts/ai-timestamp/dist/public')));

// Basic API endpoint
app.get('/api/time', (req, res) => {
    const currentTime = new Date().toISOString();
    res.json({ time: currentTime });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});