import { Request, Response, NextFunction } from "express";
import { ZodTypeAny, ZodError } from "zod";
import logger from "../utils/logger";

export const validateSchema = (schema: ZodTypeAny) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await schema.parseAsync({
                body: req.body,
                query: req.query,
                params: req.params,
            });
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                logger.warn("Validation error", { error: error.issues });
                res.status(400).json({
                    error: "Validation failed",
                    details: error.issues,
                });
                return;
            }
            logger.error("Internal validation error", { error });
            res.status(500).json({ error: "Internal validation error" });
        }
    };
};
