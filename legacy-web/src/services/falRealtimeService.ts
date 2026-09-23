import { fal } from '@fal-ai/client';

export const FAL_REALTIME_APP = 'decart/lucy2-vton/realtime';

export interface FalRealtimeOptions {
  stream: MediaStream;
  planId: 'free' | 'premium' | 'pro';
  referenceImageUrl?: string;
  onRemoteStream: (stream: MediaStream) => void;
  onStatus: (status: 'connecting' | 'live' | 'error') => void;
  onError: (error: Error) => void;
}

export interface FalRealtimeSession {
  updateReference: (referenceImageUrl: string, prompt?: string) => void;
  close: () => void;
}

interface SignalResult {
  type?: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  iceservers?: RTCIceServer[];
  iceServers?: RTCIceServer[];
  ice_servers?: RTCIceServer[];
  turn_config?: {
    server_url: string;
    username: string;
    credential: string;
  };
  success?: boolean;
  error?: string;
}

/**
 * Creates the browser side of Lucy's signaling + WebRTC session.
 * FAL_KEY never enters this module: the SDK asks our backend for a short-lived JWT.
 */
export function connectFalRealtime(options: FalRealtimeOptions): FalRealtimeSession {
  let peer: RTCPeerConnection | null = null;
  let closed = false;
  let connected = false;

  const connection = fal.realtime.connect<
    { prompt?: string; reference_image_url?: string },
    SignalResult
  >(FAL_REALTIME_APP, {
    connectionKey: `mirobe-${Date.now()}`,
    throttleInterval: 0,
    maxBuffering: 2,
    tokenProvider: async (app) => {
      const response = await fetch('/api/fal/realtime-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app, plan: options.planId }),
      });

      if (!response.ok) {
        throw new Error((await response.text()) || 'Fal token alınamadı');
      }
      return response.text();
    },
    tokenExpirationSeconds: 10,
    onResult: async (result) => {
      if (closed) return;

      try {
        const signalType = result.type?.toLowerCase();
        if (signalType === 'iceservers' || signalType === 'ice_servers') {
          const servers = result.iceservers || result.iceServers || result.ice_servers || [];
          peer = new RTCPeerConnection({ iceServers: servers });
          options.stream.getTracks().forEach((track) => peer?.addTrack(track, options.stream));

          peer.ontrack = (event) => {
            const remote = event.streams[0];
            if (remote) {
              connected = true;
              options.onStatus('live');
              options.onRemoteStream(remote);
            }
          };

          peer.onicecandidate = (event) => {
            if (event.candidate && !closed) {
              connection.send({
                type: 'icecandidate',
                candidate: {
                  candidate: event.candidate.candidate,
                  sdpMid: event.candidate.sdpMid,
                  sdpMLineIndex: event.candidate.sdpMLineIndex,
                },
              } as never);
            }
          };

          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          connection.send({ type: 'offer', sdp: offer.sdp } as never);
          return;
        }

        if (signalType === 'answer' && peer && result.sdp) {
          await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp });
          return;
        }

        if (signalType === 'icecandidate' && peer && result.candidate) {
          await peer.addIceCandidate(new RTCIceCandidate(result.candidate));
          return;
        }

        if (signalType === 'ice-restart' && peer && result.turn_config) {
          peer.setConfiguration({
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              {
                urls: result.turn_config.server_url,
                username: result.turn_config.username,
                credential: result.turn_config.credential,
              },
            ],
          });
          const offer = await peer.createOffer({ iceRestart: true });
          await peer.setLocalDescription(offer);
          connection.send({ type: 'offer', sdp: offer.sdp } as never);
          return;
        }

        if (signalType === 'error' || (signalType === 'prompt_ack' && result.success === false)) {
          throw new Error(result.error || 'Fal canlı oturum hatası');
        }
      } catch (error) {
        options.onStatus('error');
        options.onError(error instanceof Error ? error : new Error('Fal canlı oturum hatası'));
      }
    },
    onError: (error) => {
      options.onStatus('error');
      options.onError(error instanceof Error ? error : new Error('Fal bağlantısı kurulamadı'));
    },
  });

  options.onStatus('connecting');
  connection.send({
    prompt:
      'Substitute the current top with the outfit from the reference image, matching its color, material, and fit. Preserve the person, face, motion, lighting and background.',
    ...(options.referenceImageUrl ? { reference_image_url: options.referenceImageUrl } : {}),
  });

  return {
    updateReference: (referenceImageUrl, prompt) => {
      if (closed) return;
      connection.send({
        reference_image_url: referenceImageUrl,
        prompt:
          prompt ||
          'Substitute the current top with the outfit from the reference image, matching its color, material, and fit. Preserve the person, face, motion, lighting and background.',
      });
    },
    close: () => {
      if (closed) return;
      closed = true;
      peer?.getSenders().forEach((sender) => sender.replaceTrack(null));
      peer?.close();
      connection.close();
      if (!connected) options.onStatus('error');
    },
  };
}
