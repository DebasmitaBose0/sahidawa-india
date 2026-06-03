import { Router, RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validateSchema } from '../middleware/validate';
import { apiLimiter } from '../middleware/rateLimit';
import {
  getPendingReports,
  updateReportStatus,
  getAllMedicines,
  createMedicine,
  reportStatusSchema,
  medicineSchema,
} from '../controllers/admin.controller';

const router = Router();

router.use(requireAuth, requireRole('admin', 'moderator'));
router.use(apiLimiter as RequestHandler);

/**
 * @swagger
 * /api/v1/admin/reports:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get pending reports
 *     description: Retrieve all counterfeit reports that are currently in 'pending' status. Requires admin or moderator role.
 *     responses:
 *       200:
 *         description: List of pending reports
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal server error
 */
router.get('/reports', getPendingReports);

/**
 * @swagger
 * /api/v1/admin/reports/{id}/status:
 *   patch:
 *     tags:
 *       - Admin
 *     summary: Update report status
 *     description: Update the status of a specific counterfeit report and log the action.
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
 *         description: Report status updated
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Report not found
 *       500:
 *         description: Internal server error
 */
router.patch('/reports/:id/status', validateSchema(reportStatusSchema), updateReportStatus);

/**
 * @swagger
 * /api/v1/admin/medicines:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get all medicines
 *     description: Retrieve a paginated list of all medicines in the database.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Paginated list of medicines
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal server error
 */
router.get('/medicines', getAllMedicines);

/**
 * @swagger
 * /api/v1/admin/medicines:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Create a new medicine
 *     description: Add a new medicine to the database and log the creation.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - brand_name
 *               - generic_name
 *               - manufacturer
 *             properties:
 *               brand_name:
 *                 type: string
 *               generic_name:
 *                 type: string
 *               manufacturer:
 *                 type: string
 *               barcode_id:
 *                 type: string
 *               cdsco_approval_status:
 *                 type: string
 *                 enum: [approved, recalled, banned]
 *                 default: approved
 *     responses:
 *       201:
 *         description: Medicine created successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal server error
 */
router.post('/medicines', validateSchema(medicineSchema), createMedicine);

export default router;
