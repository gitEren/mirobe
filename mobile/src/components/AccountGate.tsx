import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useAccountGate } from '@/lib/store';
import { colors } from '@/lib/theme';

/**
 * Wraps a camera/AI screen: anonymous visitors are sent to sign in before the
 * screen (and its camera) mounts. `route` is where signing in returns to.
 */
export function AccountGate({
  route,
  params = {},
  dark,
  children,
}: {
  route: string;
  /** The screen's own search params, kept across the sign-in. */
  params?: Record<string, string | string[] | undefined>;
  dark?: boolean;
  children: ReactNode;
}) {
  const query = Object.entries(params)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  const allowed = useAccountGate(query ? `${route}?${query}` : route);
  if (!allowed) return <View style={{ flex: 1, backgroundColor: dark ? colors.night : colors.ivory }} />;
  return children;
}
