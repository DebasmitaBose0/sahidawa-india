import { Router, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { validateSchema } from "../middleware/validate";
import { apiLimiter } from "../middleware/rateLimit";
import {
    getMockRecallFeed,
    getVapidPublicKey,
    isWebPushConfigured,
    pushSubscriptionSchema,
    recallAlertSchema,
    removePushSubscription,
    savePushSubscription,
    triggerRecallAlert,
} from "../services/notifications";

const router = Router();

const subscribeSchema = z.object({
    body: pushSubscriptionSchema,
});

const unsubscribeReqSchema = z.object({
    body: z.object({
        endpoint: z.string().url(),
    }),
});

const triggerRecallReqSchema = z.object({
    body: recallAlertSchema.partial({ id: true }),
});

/**
 * @swagger
 * /api/v1/notifications/vapid-public-key:
 *   get:
 *     summary: Get VAPID public key
 *     description: Retrieve the VAPID public key for push notifications.
 *     tags: [Notifications]
 *     responses:
 *       200:
 *         description: VAPID public key retrieved successfully
 *       429:
 *         description: Too many requests
 */
router.get("/vapid-public-key", apiLimiter as RequestHandler, (_req: Request, res: Response) => {
    const publicKey = getVapidPublicKey();
    res.json({
        publicKey,
        configured: isWebPushConfigured(),
    });
});

/**
 * @swagger
 * /api/v1/notifications/subscriptions:
 *   post:
 *     summary: Subscribe to push notifications
 *     description: Save a new push notification subscription.
 *     tags: [Notifications]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Subscription saved
 *       400:
 *         description: Validation error
 *       429:
 *         description: Too many requests
 */
router.post("/subscriptions", apiLimiter as RequestHandler, validateSchema(subscribeSchema), async (req: Request, res: Response): Promise<void> => {
    const result = await savePushSubscription(req.body);

    res.status(201).json({
        endpoint: result.stored.endpoint,
        persisted: result.persisted,
        warning: result.persisted
            ? undefined
            : "Stored in memory because push_subscriptions table is unavailable.",
    });
});

/**
 * @swagger
 * /api/v1/notifications/subscriptions:
 *   delete:
 *     summary: Unsubscribe from push notifications
 *     description: Remove a push notification subscription.
 *     tags: [Notifications]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               endpoint:
 *                 type: string
 *     responses:
 *       204:
 *         description: Subscription removed
 *       400:
 *         description: Validation error
 *       429:
 *         description: Too many requests
 */
router.delete("/subscriptions", apiLimiter as RequestHandler, validateSchema(unsubscribeReqSchema), async (req: Request, res: Response): Promise<void> => {
    await removePushSubscription(req.body.endpoint);
    res.status(204).send();
});

/**
 * @swagger
 * /api/v1/notifications/recalls/mock:
 *   get:
 *     summary: Get mock recall feed
 *     description: Retrieve a mock feed of recall alerts for testing.
 *     tags: [Notifications]
 *     responses:
 *       200:
 *         description: Mock recall feed retrieved
 *       429:
 *         description: Too many requests
 */
router.get("/recalls/mock", apiLimiter as RequestHandler, (_req: Request, res: Response) => {
    res.json({ recalls: getMockRecallFeed() });
});

/**
 * @swagger
 * /api/v1/notifications/recalls/mock/trigger:
 *   post:
 *     summary: Trigger mock recall alert
 *     description: Trigger a mock recall alert for testing purposes. Requires admin role.
 *     tags: [Notifications]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Mock alert triggered
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       429:
 *         description: Too many requests
 */
router.post(
    "/recalls/mock/trigger",
    apiLimiter as RequestHandler,
    requireAuth,
    requireRole("admin"),
    validateSchema(triggerRecallReqSchema),
    async (req: Request, res: Response): Promise<void> => {
        if (process.env.NODE_ENV === "production") {
            res.status(403).json({ error: "Mock triggers are disabled in production" });
            return;
        }

        const feed = getMockRecallFeed();
        const alert = recallAlertSchema.parse({
            ...feed[0],
            ...req.body,
            id: req.body.id ?? `manual-${Date.now()}`,
            recalledAt: req.body.recalledAt ?? new Date().toISOString(),
        });

        const result = await triggerRecallAlert(alert);

        res.json({
            alert,
            delivery: result,
        });
    }
);

export default router;
