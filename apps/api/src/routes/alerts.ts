import { Router, Request, Response, RequestHandler } from "express";
import { supabase } from "../db/client";
import { z } from "zod";
import { triggerRecallAlert } from "../services/notifications";
import { validateSchema } from "../middleware/validate";
import { apiLimiter } from "../middleware/rateLimit";

if (!process.env.API_SECRET_KEY) {
    console.error("CRITICAL ERROR: API_SECRET_KEY is not set. Terminating.");
    process.exit(1);
}

const AlertSchema = z
    .object({
        reported_brand_name: z.string().optional(),
        batch_number: z.string().optional(),
        manufacturer: z.string().optional(),
        alert_type: z.string().optional(),
        state: z.string().optional(),
        district: z.string().optional(),
        reported_at: z.string().optional(),
    })
    .passthrough();

const AlertsArraySchema = z.array(AlertSchema);

const getAlertsQuerySchema = z.object({
    query: z.object({
        page: z.string().optional(),
        limit: z.string().optional(),
        brand: z.string().optional(),
        region: z.string().optional(),
        batch_number: z.string().optional(),
    }),
});

const ingestAlertsSchema = z.object({
    body: z.object({
        alerts: AlertsArraySchema,
    }),
});

const alertsRouter = Router();

/**
 * @swagger
 * /api/v1/alerts:
 *   get:
 *     summary: Get paginated drug alerts
 *     description: Retrieve drug alerts with optional filters.
 *     tags: [Alerts]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: 1-based page index
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Items per page
 *       - in: query
 *         name: brand
 *         schema:
 *           type: string
 *         description: Filter by brand name
 *       - in: query
 *         name: region
 *         schema:
 *           type: string
 *         description: Filter by region/state
 *       - in: query
 *         name: batch_number
 *         schema:
 *           type: string
 *         description: Filter by batch number
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 pageIndex:
 *                   type: integer
 *                 pageSize:
 *                   type: integer
 *                 totalCount:
 *                   type: integer
 *                 totalPageCount:
 *                   type: integer
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
alertsRouter.get("/", apiLimiter as RequestHandler, validateSchema(getAlertsQuerySchema), async (req: Request, res: Response) => {
    const rawPage = parseInt(req.query.page as string, 10);
    const rawLimit = parseInt(req.query.limit as string, 10);
    const brand = req.query.brand as string;
    const region = req.query.region as string;
    const batchNumber = req.query.batch_number as string;

    const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
    const limit = isNaN(rawLimit) || rawLimit < 1 ? 10 : Math.min(rawLimit, 100);

    const offset = (page - 1) * limit;

    let query = supabase.from("drug_alerts").select("*", { count: "exact" });

    if (brand) {
        query = query.ilike("reported_brand_name", `%${brand}%`);
    }
    if (region) {
        query = query.ilike("state", `%${region}%`);
    }
    if (batchNumber) {
        query = query.eq("batch_number", batchNumber);
    }

    const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

    if (error) {
        res.status(500).json({ error: "Failed to fetch alerts" });
        return;
    }

    const totalCount = count ?? 0;
    const totalPageCount = Math.ceil(totalCount / limit);

    res.json({
        data: data ?? [],
        pageIndex: page,
        pageSize: (data ?? []).length,
        totalCount,
        totalPageCount,
    });
});

/**
 * @swagger
 * /api/v1/alerts/ingest:
 *   post:
 *     summary: Ingest CDSCO alerts
 *     description: Protected endpoint to ingest parsed CDSCO alerts from the ML agent. Requires secret header.
 *     tags: [Alerts]
 *     parameters:
 *       - in: header
 *         name: x-api-secret
 *         required: true
 *         schema:
 *           type: string
 *         description: Secret API key
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               alerts:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Successfully ingested
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
alertsRouter.post("/ingest", apiLimiter as RequestHandler, validateSchema(ingestAlertsSchema), async (req: Request, res: Response): Promise<void> => {
    // 1. Validate Secret Header
    const authHeader = req.headers["x-api-secret"];
    const expectedSecret = process.env.API_SECRET_KEY;

    if (!authHeader || authHeader !== expectedSecret) {
        res.status(401).json({ error: "Unauthorized access" });
        return;
    }

    const { alerts } = req.body;
    // Alerts are already validated by the Zod middleware
    const validatedAlerts = alerts;

    try {
        // 2. Insert alerts into drug_alerts table
        const { data: insertedAlerts, error: insertError } = await supabase
            .from("drug_alerts")
            .insert(validatedAlerts)
            .select();

        if (insertError) {
            console.error("Error inserting alerts:", insertError);
            res.status(500).json({ error: "Database error inserting alerts" });
            return;
        }

        // 3. Update medicines table based on matched batches
        const updatePromises = validatedAlerts.map((alert: any) => {
            if (alert.batch_number) {
                let q = supabase
                    .from("medicines")
                    .update({ status: "recalled", is_counterfeit_alert: true })
                    .eq("batch_number", alert.batch_number);

                if (alert.manufacturer) {
                    q = q.eq("manufacturer", alert.manufacturer);
                } else if (alert.reported_brand_name) {
                    q = q.eq("brand_name", alert.reported_brand_name);
                }
                return q;
            }
            return Promise.resolve();
        });

        await Promise.all(updatePromises);

        // 4. Dispatch Web Push Notifications using shared service
        if (insertedAlerts && insertedAlerts.length > 0) {
            const pushPromises = insertedAlerts.map((alert: any) => {
                return triggerRecallAlert({
                    id: alert.id ? String(alert.id) : "unknown",
                    medicineName: alert.reported_brand_name || "Unknown Medicine",
                    batchNumber: alert.batch_number,
                    manufacturer: alert.manufacturer,
                    reason: `Alert of type ${alert.alert_type || "NSQ"} in ${alert.state || "Unknown region"}`,
                    severity: "high",
                    source: "CDSCO Live Feed",
                    recalledAt: alert.reported_at || new Date().toISOString(),
                });
            });
            await Promise.all(pushPromises);
        }

        res.status(200).json({
            success: true,
            message: "Alerts ingested and notifications dispatched",
            inserted: insertedAlerts?.length,
        });
    } catch (error) {
        console.error("Unexpected error in /ingest:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default alertsRouter;
