import { Router, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { validateSchema } from "../middleware/validate";
import { apiLimiter } from "../middleware/rateLimit";

const router = Router();

const analyticsQuerySchema = z.object({
  query: z.object({
    days: z.string().optional().transform((val) => val ? parseInt(val, 10) : 30),
  }),
});

/**
 * @swagger
 * /api/v1/analytics/heatmap:
 *   get:
 *     summary: Get counterfeit heat map data
 *     description: Returns GeoJSON data representing counterfeit medicine clusters.
 *     tags: [Analytics]
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Number of days to look back
 *     responses:
 *       200:
 *         description: GeoJSON feature collection
 *       400:
 *         description: Validation error
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Server error
 */
router.get('/heatmap', apiLimiter as RequestHandler, validateSchema(analyticsQuerySchema), async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string, 10) || 30;
    // Placeholder for actual DB data
    const mockData = [{ lat: 21.25, lng: 81.63, created_at: new Date().toISOString() }];

    const geoJson = {
      type: "FeatureCollection",
      features: mockData.map(d => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [d.lng, d.lat] },
        properties: { intensity: 1 }
      }))
    };
    res.json(geoJson);
  } catch (e) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;