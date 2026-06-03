import { Router, Request, Response, RequestHandler } from "express";
import { detectLasaConflicts } from "../services/lasa.service";
import logger from "../utils/logger";
import { z } from "zod";
import { validateSchema } from "../middleware/validate";
import { apiLimiter } from "../middleware/rateLimit";

const router = Router();

const lasaCheckSchema = z.object({
    body: z.object({
        medicineName: z.string({
            message: "medicineName is required and must be a string"
        } as any).min(1, "medicineName cannot be empty"),
    }),
});

/**
 * @swagger
 * /api/v1/lasa/check:
 *   post:
 *     summary: Check for LASA (Look-Alike Sound-Alike) conflicts
 *     description: Detects if the provided medicine name has any LASA conflicts with known medicines.
 *     tags: [LASA]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - medicineName
 *             properties:
 *               medicineName:
 *                 type: string
 *                 example: "Dolo 650"
 *     responses:
 *       200:
 *         description: LASA check completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hasConflicts:
 *                   type: boolean
 *                   example: true
 *                 matches:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Validation error
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
router.post("/check", apiLimiter as RequestHandler, validateSchema(lasaCheckSchema), async (req: Request, res: Response): Promise<void> => {
    try {
        const { medicineName } = req.body;
        const matches = await detectLasaConflicts(medicineName);

        res.status(200).json({
            hasConflicts: matches.length > 0,
            matches,
        });
    } catch (error) {
        logger.error("Error in LASA check", { error });
        res.status(500).json({ error: "Failed to perform LASA check" });
    }
});

export default router;
