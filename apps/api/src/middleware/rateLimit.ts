import rateLimit from "express-rate-limit";

// General API Rate Limiter
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 mins
    max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
        res.status(429).json({
            error: "Too many requests to this API. Please try again later.",
        });
    },
});

// Specific Limiter for Verifications / Scans
export const verifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 mins
    max: 20, // Limit each IP to 20 requests per `window`
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
        res.status(429).json({
            error: "Too many verification requests. Please try again later.",
        });
    },
});

// Specific Limiter for Authentication / Sensitive endpoints
export const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // Limit each IP to 10 requests per `window`
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
        res.status(429).json({
            error: "Too many authentication attempts. Please try again later.",
        });
    },
});