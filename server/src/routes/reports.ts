import express, { type RequestHandler } from 'express';
import { AiReportSchema } from '@mirobe/shared';
import type { Db } from '../db/index';
import { route } from '../lib/http';
import { createReport } from '../lib/reports';

interface ReportDeps {
  db: Db;
  auth: RequestHandler;
  requireAccount: RequestHandler;
}

/**
 * "Report AI output" (Google Play AI-generated content policy): a registered account flags a
 * try-on, clip, studio image, AI tags or a Jev reply. No AI consent is needed to report.
 */
export function reportRoutes({ db, auth, requireAccount }: ReportDeps) {
  const router = express.Router();

  router.post(
    '/api/reports',
    auth,
    requireAccount,
    route((req, res) => {
      res.status(201).json(createReport(db, req.userId, AiReportSchema.parse(req.body ?? {})));
    })
  );

  return router;
}
