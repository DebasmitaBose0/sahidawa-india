import { Router, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { supabase } from '../db/client';
import {
  AuthenticatedRequest,
  optionalAuth,
  requireAuth,
  requireRole,
} from '../middleware/auth';
import { validateSchema } from '../middleware/validate';
import { apiLimiter } from '../middleware/rateLimit';

const reportsRouter = Router();

const createReportSchema = z.object({
  body: z.object({
    medicineName: z.string().min(2),
    manufacturer: z.string().min(2),
    description: z.string().min(20),
    images: z.array(z.string().url()).min(1),
    pharmacyName: z.string().min(2),
    address: z.string().min(5),
    city: z.string().min(2),
    state: z.string().min(2),
    pincode: z.string().regex(/^\d{6}$/),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }),
});

const updateReportStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid().or(z.string()),
  }),
  body: z.object({
    status: z.enum(['pending', 'verified_fake', 'false_alarm']),
  }),
});

const buildReportLocation = (latitude?: number, longitude?: number) => {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return null;
  }
  return `POINT(${longitude} ${latitude})`;
};

/**
 * @swagger
 * /api/v1/reports:
 *   post:
 *     tags:
 *       - Reports
 *     summary: Submit a counterfeit report
 *     description: Submit a new counterfeit medicine report. Authentication is optional.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Report submitted successfully
 *       400:
 *         description: Validation error
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
reportsRouter.post('/', apiLimiter as RequestHandler, optionalAuth, validateSchema(createReportSchema), async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  const { data: report, error } = await supabase
    .from('counterfeit_reports')
    .insert({
      reported_brand_name: data.medicineName,
      manufacturer: data.manufacturer,
      description: data.description,
      photo_url: data.images[0],
      photo_urls: data.images,
      pharmacy_name: data.pharmacyName,
      address: data.address,
      city: data.city,
      state: data.state,
      pincode: data.pincode,
      district: data.city,
      report_location: buildReportLocation(data.latitude, data.longitude),
      reporter_id: req.user?.id ?? null,
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: 'Failed to submit counterfeit report' });
    return;
  }

  res.status(201).json({ report });
});

/**
 * @swagger
 * /api/v1/reports/mine:
 *   get:
 *     tags:
 *       - Reports
 *     summary: Get user's reports
 *     description: Fetch all reports submitted by the authenticated user.
 *     responses:
 *       200:
 *         description: List of reports
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Internal server error
 */
reportsRouter.get('/mine', apiLimiter as RequestHandler, requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  const { data, error } = await supabase
    .from('counterfeit_reports')
    .select('id, reported_brand_name, scanned_barcode, photo_url, district, status, created_at')
    .eq('reporter_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Failed to fetch your reports' });
    return;
  }

  res.json({ reports: data ?? [] });
});

/**
 * @swagger
 * /api/v1/reports:
 *   get:
 *     tags:
 *       - Reports
 *     summary: Get all reports (Admin)
 *     description: Fetch all counterfeit reports. Requires admin role.
 *     responses:
 *       200:
 *         description: List of all reports
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal server error
 */
reportsRouter.get('/', apiLimiter as RequestHandler, requireAuth, requireRole('admin'), async (_req, res: Response) => {
  const { data, error } = await supabase
    .from('counterfeit_reports')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Failed to fetch counterfeit reports' });
    return;
  }

  res.json({ reports: data });
});

/**
 * @swagger
 * /api/v1/reports/{id}/status:
 *   patch:
 *     tags:
 *       - Reports
 *     summary: Update report status (Admin)
 *     description: Update the status of a specific report. Requires admin role.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, verified_fake, false_alarm]
 *     responses:
 *       200:
 *         description: Report updated successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal server error
 */
reportsRouter.patch('/:id/status', apiLimiter as RequestHandler, requireAuth, requireRole('admin'), validateSchema(updateReportStatusSchema), async (req, res: Response) => {
  const { status } = req.body;

  const { data, error } = await supabase
    .from('counterfeit_reports')
    .update({ status })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: 'Failed to update report status' });
    return;
  }

  res.json({ report: data });
});

export default reportsRouter;
