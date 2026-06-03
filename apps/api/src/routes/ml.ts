import { Router, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { validateSchema } from "../middleware/validate";
import { apiLimiter } from "../middleware/rateLimit";

const router = Router();

const analyzeReqSchema = z.object({
    body: z.object({
        imageUrl: z.string().url().startsWith("https://", "imageUrl must be an HTTPS URL"),
    }),
});

const analyzeResponseSchema = z.object({
    isFake: z.boolean(),
    confidence: z.number().min(0).max(1),
    verdict: z.enum(["likely_genuine", "suspicious", "likely_fake"]),
    details: z.string(),
});

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
const ML_ANALYSIS_TIMEOUT_MS = 8000;

/**
 * @swagger
 * /api/v1/ml/analyze:
 *   post:
 *     tags:
 *       - Machine Learning
 *     summary: Analyze an image for counterfeits
 *     description: Analyzes a medicine image URL using the FastAPI ML microservice.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - imageUrl
 *             properties:
 *               imageUrl:
 *                 type: string
 *                 format: uri
 *                 example: "https://example.com/medicine.jpg"
 *     responses:
 *       200:
 *         description: Image analysis results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 isFake:
 *                   type: boolean
 *                 confidence:
 *                   type: number
 *                 verdict:
 *                   type: string
 *                   enum: [likely_genuine, suspicious, likely_fake]
 *                 details:
 *                   type: string
 *       400:
 *         description: Validation error
 *       429:
 *         description: Too many requests
 *       502:
 *         description: ML Service error
 *       504:
 *         description: ML Service timeout
 */
router.post("/analyze", apiLimiter as RequestHandler, validateSchema(analyzeReqSchema), async (req: Request, res: Response): Promise<void> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ML_ANALYSIS_TIMEOUT_MS);

    try {
        const mlResponse = await fetch(`${ML_SERVICE_URL}/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
            signal: controller.signal,
        });

        const body = (await mlResponse.json().catch(() => ({}))) as unknown;

        if (!mlResponse.ok) {
            res.status(mlResponse.status).json({
                error: "Image analysis failed",
                details:
                    typeof body === "object" && body !== null && "detail" in body
                        ? (body as { detail?: unknown }).detail
                        : undefined,
            });
            return;
        }

        const analysis = analyzeResponseSchema.safeParse(body);
        if (!analysis.success) {
            res.status(502).json({ error: "Image analysis service returned an invalid response" });
            return;
        }

        res.status(200).json(analysis.data);
    } catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError";
        res.status(isAbort ? 504 : 502).json({
            error: isAbort ? "Image analysis timed out" : "Image analysis service is unavailable",
        });
    } finally {
        clearTimeout(timeout);
    }
});

export default router;
