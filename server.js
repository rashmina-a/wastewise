const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// Proxy endpoint for fetching available models
app.post('/api/proxy/models', async (req, res) => {
    try {
        const { apiKey } = req.body;

        if (!apiKey) {
            return res.status(400).json({ error: 'API key is required' });
        }

        const response = await fetch('https://integrate.api.nvidia.com/v1/models', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            return res.status(response.status).json({ error: errorText });
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Models proxy error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Proxy endpoint for NVIDIA NIM API
app.post('/api/proxy', async (req, res) => {
    try {
        const { apiKey, model, imageData } = req.body;

        if (!apiKey) {
            return res.status(400).json({ error: 'API key is required' });
        }

        const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: `You are a waste classification expert. Analyze this image of waste/trash items.

Identify EVERY visible waste item and for EACH item provide:
1. A short descriptive name (e.g., "plastic bottle", "banana peel", "newspaper")
2. A category: exactly one of "recycling", "general", or "organic"
   - recycling: paper, cardboard, glass, metal cans, plastic bottles, clean containers
   - general: mixed/unclean items, diapers, sanitary products, broken items, non-recyclable plastics
   - organic: food scraps, fruit peels, coffee grounds, yard waste, compostable materials
3. A bounding box as [x, y, width, height] where each value is a percentage (0-100) of the image dimensions, representing the top-left corner (x, y) and size (width, height) of the item.

IMPORTANT: Return ONLY valid JSON with no markdown, no code blocks, no extra text. Use this exact format:
{"items":[{"name":"item name","category":"recycling","bbox":[10,20,30,40]}]}

If you see a plastic polythene bag or wrapper, classify it as "general" waste. If you see a plastic bottle, classify it as "recycling".`
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:image/jpeg;base64,${imageData}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 2048,
                temperature: 0.0
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('NVIDIA API error:', response.status, errorText);
            return res.status(response.status).json({ error: errorText });
        }

        const data = await response.json();
        console.log('NVIDIA API raw content:', data.choices?.[0]?.message?.content?.substring(0, 500));
        res.json(data);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`WasteWise server running on http://localhost:${PORT}`);
});
