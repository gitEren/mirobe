import { createFalClient } from '@fal-ai/client';
import { mediaDevices, MediaStream, RTCIceCandidate, RTCPeerConnection } from 'react-native-webrtc';
import type { LiveStartResponse } from '@mirobe/shared';
import { api } from './api';

interface SignalMessage {
  type?: string;
  sdp?: string;
  candidate?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null };
  iceservers?: RTCIceServer[];
  iceServers?: RTCIceServer[];
  ice_servers?: RTCIceServer[];
  turn_config?: { server_url: string; username: string; credential: string };
  success?: boolean;
  error?: string;
}

export interface LiveSession {
  localStream: MediaStream;
  close: () => void;
  updateReference: (referenceImageUrl: string, prompt: string) => void;
}

/**
 * React Native port of the web fal realtime client (decart/lucy2-vton). The
 * server hands out a short-lived token scoped to this one app; FAL_KEY never
 * reaches the device. Signalling runs over fal's realtime socket, media over
 * WebRTC.
 */
export async function startLiveSession(
  start: LiveStartResponse,
  handlers: { onRemoteStream: (stream: MediaStream) => void; onError: (error: Error) => void }
): Promise<LiveSession> {
  const localStream = await mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', frameRate: 24, width: 720, height: 1280 },
  });

  let peer: RTCPeerConnection | null = null;
  let closed = false;
  let firstToken: string | null = start.token;
  const fal = createFalClient();

  const connection = fal.realtime.connect<Record<string, unknown>, SignalMessage>(start.app, {
    connectionKey: `mirobe-${start.sessionId}`,
    throttleInterval: 0,
    maxBuffering: 2,
    tokenExpirationSeconds: 100,
    tokenProvider: async () => {
      if (firstToken) {
        const token = firstToken;
        firstToken = null;
        return token;
      }
      return (await api.liveToken(start.sessionId)).token;
    },
    onResult: async (message) => {
      if (closed) return;
      try {
        const type = message.type?.toLowerCase();
        if (type === 'iceservers' || type === 'ice_servers') {
          peer = new RTCPeerConnection({ iceServers: message.iceservers || message.iceServers || message.ice_servers || [] });
          localStream.getTracks().forEach((track) => peer!.addTrack(track, localStream));
          // Vendored event-target typings are not shipped, so use the on* setters.
          peer.ontrack = (event: any) => {
            const remote = event.streams?.[0];
            if (remote) handlers.onRemoteStream(remote);
          };
          peer.onicecandidate = (event: any) => {
            if (!event.candidate || closed) return;
            connection.send({
              type: 'icecandidate',
              candidate: {
                candidate: event.candidate.candidate,
                sdpMid: event.candidate.sdpMid,
                sdpMLineIndex: event.candidate.sdpMLineIndex,
              },
            });
          };
          const offer = await peer.createOffer({});
          await peer.setLocalDescription(offer);
          connection.send({ type: 'offer', sdp: offer.sdp });
          return;
        }
        if (type === 'answer' && peer && message.sdp) {
          await peer.setRemoteDescription({ type: 'answer', sdp: message.sdp });
          return;
        }
        if (type === 'icecandidate' && peer && message.candidate) {
          await peer.addIceCandidate(new RTCIceCandidate(message.candidate));
          return;
        }
        if (type === 'ice-restart' && peer && message.turn_config) {
          peer.setConfiguration({
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: message.turn_config.server_url, username: message.turn_config.username, credential: message.turn_config.credential },
            ],
          });
          const offer = await peer.createOffer({ iceRestart: true });
          await peer.setLocalDescription(offer);
          connection.send({ type: 'offer', sdp: offer.sdp });
          return;
        }
        if (type === 'error' || (type === 'prompt_ack' && message.success === false)) {
          throw new Error(message.error || 'Live session error');
        }
      } catch (error) {
        handlers.onError(error instanceof Error ? error : new Error(String(error)));
      }
    },
    onError: (error) => handlers.onError(error instanceof Error ? error : new Error('Live connection failed')),
  });

  connection.send({ prompt: start.prompt, reference_image_url: start.referenceImageUrl });

  return {
    localStream,
    updateReference: (referenceImageUrl, prompt) => {
      if (!closed) connection.send({ reference_image_url: referenceImageUrl, prompt });
    },
    close: () => {
      if (closed) return;
      closed = true;
      peer?.close();
      connection.close();
      localStream.getTracks().forEach((track) => track.stop());
      localStream.release?.();
    },
  };
}
