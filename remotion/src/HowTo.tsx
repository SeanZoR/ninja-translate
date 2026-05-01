import React from 'react';
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const FPS = 30;
export const WIDTH = 1280;
export const HEIGHT = 720;

const SCENE_FRAMES = 90; // 3 seconds per scene
const SCENE_COUNT = 4;
export const DURATION_FRAMES = SCENE_FRAMES * SCENE_COUNT;

// Match web/styles.css palette so the video feels like part of the product.
const COLORS = {
  bg: '#0f1115',
  panel: '#161a22',
  border: '#262c38',
  text: '#e7eaf0',
  muted: '#8c93a3',
  accent: '#74e1c0',
};

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';

const Card: React.FC<{
  step: number;
  title: string;
  body: string;
  emoji: string;
}> = ({ step, title, body, emoji }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 90 } });
  const opacity = interpolate(enter, [0, 1], [0, 1]);
  const translateY = interpolate(enter, [0, 1], [30, 0]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        fontFamily: FONT_STACK,
        color: COLORS.text,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 80,
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 18,
          padding: '48px 64px',
          maxWidth: 900,
          width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            color: COLORS.accent,
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: 2,
            textTransform: 'uppercase',
            marginBottom: 12,
          }}
        >
          <span>Step {step}</span>
          <span style={{ flex: 1, height: 1, background: COLORS.border }} />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 18,
            marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 56 }}>{emoji}</span>
          <h1 style={{ fontSize: 44, margin: 0, lineHeight: 1.1 }}>{title}</h1>
        </div>
        <p style={{ fontSize: 22, color: COLORS.muted, lineHeight: 1.5, margin: 0 }}>{body}</p>
      </div>
    </AbsoluteFill>
  );
};

const Brand: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <div
      style={{
        position: 'absolute',
        top: 32,
        left: 40,
        opacity,
        color: COLORS.accent,
        fontFamily: FONT_STACK,
        fontWeight: 700,
        fontSize: 22,
        letterSpacing: 0.5,
      }}
    >
      🥷 Ninja Translate
    </div>
  );
};

export const HowTo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <Brand />
      <Sequence from={0} durationInFrames={SCENE_FRAMES}>
        <Card
          step={1}
          emoji="👥"
          title="Add the bot to a group"
          body="Ninja Translate lives inside the WhatsApp group and translates voice notes and @mentions across every language people speak."
        />
      </Sequence>
      <Sequence from={SCENE_FRAMES} durationInFrames={SCENE_FRAMES}>
        <Card
          step={2}
          emoji="🎙"
          title="Send a voice note or @mention"
          body="Voice notes are translated automatically. For text messages, just @mention the bot to translate."
        />
      </Sequence>
      <Sequence from={SCENE_FRAMES * 2} durationInFrames={SCENE_FRAMES}>
        <Card
          step={3}
          emoji="💬"
          title="DM the bot for your settings link"
          body="Send any DM to the bot. It replies with a private link to your personal preferences."
        />
      </Sequence>
      <Sequence from={SCENE_FRAMES * 3} durationInFrames={SCENE_FRAMES}>
        <Card
          step={4}
          emoji="🎚"
          title="Tune polish, tone, and more"
          body="Your prefs follow you to every group. Hit save and you're done."
        />
      </Sequence>
    </AbsoluteFill>
  );
};
