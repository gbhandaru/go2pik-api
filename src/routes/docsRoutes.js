const express = require('express');
const path = require('path');


const router = express.Router();
const specPath = path.resolve(__dirname, '../../docs/openapi-menu.yaml');
const specUrl = '/api/docs/menu/openapi.yaml';

router.get('/menu/openapi.yaml', (req, res) => {
  res.sendFile(specPath);
});

router.get('/menu', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Go2Pik API Docs - Menu</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #f4f1ea; font-family: Arial, sans-serif; }
      .swagger-ui .topbar { display: none; }
      .swagger-ui .info .title { color: #1f2937; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = function () {
        SwaggerUIBundle({
          url: '${specUrl}',
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis],
          layout: 'BaseLayout'
        });
      };
    </script>
  </body>
</html>`);
});

module.exports = router;
