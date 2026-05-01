import { Composition } from 'remotion';
import { HowTo, FPS, DURATION_FRAMES, WIDTH, HEIGHT } from './HowTo';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HowTo"
        component={HowTo}
        durationInFrames={DURATION_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    </>
  );
};
