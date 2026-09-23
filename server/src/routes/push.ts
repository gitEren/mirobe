import express, { type RequestHandler } from 'express';
import { NotificationSettingsSchema, PushTokenSchema, RemovePushTokenSchema } from '@mirobe/shared';
import type { Db } from '../db/index';
import { route } from '../lib/http';
import { notificationSettings, removePushToken, savePushToken, setNotificationSettings } from '../lib/push';

interface PushDeps {
  db: Db;
  auth: RequestHandler;
}

/**
 * Device push tokens and the account's notification switches. Anonymous sessions may
 * register too: re-registering a token moves it off the account the device signed out of.
 */
export function pushRoutes({ db, auth }: PushDeps) {
  const router = express.Router();

  router.post(
    '/api/push/tokens',
    auth,
    route((req, res) => {
      savePushToken(db, req.userId, PushTokenSchema.parse(req.body));
      res.json({ ok: true });
    })
  );

  router.delete(
    '/api/push/tokens',
    auth,
    route((req, res) => {
      const { token } = RemovePushTokenSchema.parse(req.body ?? {});
      res.json({ ok: true, removed: removePushToken(db, req.userId, token) });
    })
  );

  router.get(
    '/api/me/notification-settings',
    auth,
    route((req, res) => {
      res.json(notificationSettings(db, req.userId));
    })
  );

  router.put(
    '/api/me/notification-settings',
    auth,
    route((req, res) => {
      res.json(setNotificationSettings(db, req.userId, NotificationSettingsSchema.parse(req.body)));
    })
  );

  return router;
}
