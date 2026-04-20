package cn.toside.music.mobile.mixer;

import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;

import androidx.annotation.Nullable;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.exoplayer.ExoPlayer;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;

public class MixerModule extends ReactContextBaseJavaModule {
  private static final long POSITION_POLL_INTERVAL_MS = 16L;
  private static final long SEEK_RESUME_DELAY_MS = 80L;
  private static final int ANALYZE_FRAME_SAMPLES = 1024;
  private static final int PITCH_FRAME_SAMPLES = 2048;
  private static final int MIN_BPM = 70;
  private static final int MAX_BPM = 180;
  private static final double MIN_PITCH_FREQ = 80.0;
  private static final double MAX_PITCH_FREQ = 1000.0;
  private static final String[] MAJOR_KEY_LABELS = {
    "C调", "#C调", "D调", "bE调", "E调", "F调", "#F调", "G调", "bA调", "A调", "bB调", "B调"
  };
  private static final double[] MAJOR_KEY_PROFILE = {
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88
  };

  private final ReactApplicationContext reactContext;
  private final HandlerThread mixerThread;
  private final Handler mixerHandler;

  @Nullable
  private ExoPlayer activePlayer;
  @Nullable
  private ExoPlayer standbyPlayer;
  @Nullable
  private Runnable switchWatcher;
  @Nullable
  private Runnable fadeRunner;

  private float outputVolume = 1.0f;
  private float activeTrackGain = 1.0f;
  private float standbyTrackGain = 1.0f;
  private float playbackRate = 1.0f;
  private float pitch = 1.0f;
  private boolean active = false;
  private long pendingSwitchAtMs = -1L;
  private long transitionFadeDurationMs = 120L;

  MixerModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
    mixerThread = new HandlerThread("MixerModuleThread");
    mixerThread.start();
    mixerHandler = new Handler(mixerThread.getLooper());
  }

  @Override
  public String getName() {
    return "MixerModule";
  }

  @ReactMethod
  public void startTransition(
    String fromPath,
    String toPath,
    double positionMs,
    boolean playWhenReady,
    double switchAtMs,
    double fadeDurationMs,
    double volume,
    double fromGain,
    double toGain,
    Promise promise
  ) {
    runOnMixerThread(() -> {
      try {
        long startPositionMs = Math.max(0L, Math.round(positionMs));
        long switchPositionMs = Math.max(startPositionMs, Math.round(switchAtMs));
        long crossfadeMs = Math.max(60L, Math.round(fadeDurationMs));

        releaseInternal();

        outputVolume = sanitizeVolume((float) volume);
        activeTrackGain = sanitizeGain((float) fromGain);
        standbyTrackGain = sanitizeGain((float) toGain);
        transitionFadeDurationMs = crossfadeMs;
        activePlayer = buildPlayer(fromPath, startPositionMs, playWhenReady, outputVolume * activeTrackGain);
        if (toPath.equals(fromPath)) {
          standbyPlayer = null;
          pendingSwitchAtMs = -1L;
          active = true;
          applyVolumes();
          resolvePromise(promise, true);
          return;
        }

        standbyPlayer = buildPlayer(toPath, startPositionMs, playWhenReady, 0f);
        pendingSwitchAtMs = switchPositionMs;
        active = true;
        watchSwitchPoint(crossfadeMs);
        resolvePromise(promise, true);
      } catch (Exception e) {
        releaseInternal();
        rejectPromise(promise, "MIXER_START_FAILED", e);
      }
    });
  }

  @ReactMethod
  public void play(Promise promise) {
    runOnMixerThread(() -> {
      try {
        if (activePlayer != null) activePlayer.play();
        if (standbyPlayer != null) standbyPlayer.play();
        resolvePromise(promise, true);
      } catch (Exception e) {
        rejectPromise(promise, "MIXER_PLAY_FAILED", e);
      }
    });
  }

  @ReactMethod
  public void pause(Promise promise) {
    runOnMixerThread(() -> {
      try {
        if (activePlayer != null) activePlayer.pause();
        if (standbyPlayer != null) standbyPlayer.pause();
        resolvePromise(promise, true);
      } catch (Exception e) {
        rejectPromise(promise, "MIXER_PAUSE_FAILED", e);
      }
    });
  }

  @ReactMethod
  public void stop(Promise promise) {
    runOnMixerThread(() -> {
      try {
        if (activePlayer != null) activePlayer.stop();
        if (standbyPlayer != null) standbyPlayer.stop();
        releaseInternal();
        resolvePromise(promise, true);
      } catch (Exception e) {
        rejectPromise(promise, "MIXER_STOP_FAILED", e);
      }
    });
  }

  @ReactMethod
  public void release(Promise promise) {
    runOnMixerThread(() -> {
      try {
        releaseInternal();
        resolvePromise(promise, true);
      } catch (Exception e) {
        rejectPromise(promise, "MIXER_RELEASE_FAILED", e);
      }
    });
  }

  @ReactMethod
  public void seekTo(double positionMs, Promise promise) {
    runOnMixerThread(() -> {
      try {
        long target = Math.max(0L, Math.round(positionMs));
        boolean wasActivePlaying = activePlayer != null && activePlayer.getPlayWhenReady();
        boolean wasStandbyPlaying = standbyPlayer != null && standbyPlayer.getPlayWhenReady();
        boolean hasPendingTransition = standbyPlayer != null && pendingSwitchAtMs > -1L;

        clearSwitchWatcher();
        clearFadeRunner();

        if (activePlayer != null) activePlayer.pause();
        if (standbyPlayer != null) standbyPlayer.pause();

        if (activePlayer != null) activePlayer.seekTo(target);
        if (standbyPlayer != null) {
          standbyPlayer.seekTo(target);
        }

        boolean resumeActiveAfterSeek = wasActivePlaying;
        boolean resumeStandbyAfterSeek = wasStandbyPlaying;

        if (hasPendingTransition && standbyPlayer != null && target >= pendingSwitchAtMs) {
          ExoPlayer previousActive = activePlayer;
          activePlayer = standbyPlayer;
          standbyPlayer = null;
          activeTrackGain = standbyTrackGain;
          pendingSwitchAtMs = -1L;
          resumeActiveAfterSeek = wasActivePlaying || wasStandbyPlaying;
          resumeStandbyAfterSeek = false;

          if (previousActive != null) {
            previousActive.stop();
            previousActive.release();
          }
        }

        applyPlaybackParameters();
        applyVolumes();

        final boolean finalResumeActiveAfterSeek = resumeActiveAfterSeek;
        final boolean finalResumeStandbyAfterSeek = resumeStandbyAfterSeek;
        final boolean finalHasPendingTransition = standbyPlayer != null && pendingSwitchAtMs > -1L;
        final long finalFadeDurationMs = transitionFadeDurationMs;

        mixerHandler.postDelayed(() -> {
          applyPlaybackParameters();
          applyVolumes();

          if (activePlayer != null) {
            if (finalResumeActiveAfterSeek) activePlayer.play();
            else activePlayer.pause();
          }
          if (standbyPlayer != null) {
            if (finalHasPendingTransition) {
              standbyPlayer.setVolume(0f);
              if (finalResumeActiveAfterSeek || finalResumeStandbyAfterSeek) standbyPlayer.play();
              else standbyPlayer.pause();
              watchSwitchPoint(finalFadeDurationMs);
            } else if (finalResumeStandbyAfterSeek) {
              standbyPlayer.play();
            } else {
              standbyPlayer.pause();
            }
          }
          resolvePromise(promise, true);
        }, SEEK_RESUME_DELAY_MS);
      } catch (Exception e) {
        rejectPromise(promise, "MIXER_SEEK_FAILED", e);
      }
    });
  }

  @ReactMethod
  public void getPosition(Promise promise) {
    runOnMixerThread(() -> {
      long position = activePlayer == null ? 0L : activePlayer.getCurrentPosition();
      resolvePromise(promise, (double) position);
    });
  }

  @ReactMethod
  public void getDuration(Promise promise) {
    runOnMixerThread(() -> {
      long duration = activePlayer == null ? 0L : Math.max(0L, activePlayer.getDuration());
      resolvePromise(promise, (double) duration);
    });
  }

  @ReactMethod
  public void setOutputVolume(double volume, Promise promise) {
    runOnMixerThread(() -> {
      try {
        outputVolume = sanitizeVolume((float) volume);
        applyVolumes();
        resolvePromise(promise, true);
      } catch (Exception e) {
        rejectPromise(promise, "MIXER_VOLUME_FAILED", e);
      }
    });
  }

  @ReactMethod
  public void setTrackGains(double activeGain, double standbyGain, Promise promise) {
    runOnMixerThread(() -> {
      try {
        activeTrackGain = sanitizeGain((float) activeGain);
        standbyTrackGain = sanitizeGain((float) standbyGain);
        applyVolumes();
        resolvePromise(promise, true);
      } catch (Exception e) {
        rejectPromise(promise, "MIXER_GAIN_FAILED", e);
      }
    });
  }

  @ReactMethod
  public void setPlaybackRate(double rate, Promise promise) {
    runOnMixerThread(() -> {
      try {
        playbackRate = Math.max(0.25f, (float) rate);
        PlaybackParameters params = new PlaybackParameters(playbackRate, pitch);
        if (activePlayer != null) activePlayer.setPlaybackParameters(params);
        if (standbyPlayer != null) standbyPlayer.setPlaybackParameters(params);
        resolvePromise(promise, true);
      } catch (Exception e) {
        rejectPromise(promise, "MIXER_RATE_FAILED", e);
      }
    });
  }

  @ReactMethod
  public void setPitch(double nextPitch, Promise promise) {
    runOnMixerThread(() -> {
      try {
        pitch = Math.max(0.5f, Math.min(2.0f, (float) nextPitch));
        PlaybackParameters params = new PlaybackParameters(playbackRate, pitch);
        if (activePlayer != null) activePlayer.setPlaybackParameters(params);
        if (standbyPlayer != null) standbyPlayer.setPlaybackParameters(params);
        resolvePromise(promise, true);
      } catch (Exception e) {
        rejectPromise(promise, "MIXER_PITCH_FAILED", e);
      }
    });
  }

  @ReactMethod
  public void isActive(Promise promise) {
    runOnMixerThread(() -> resolvePromise(promise, active && activePlayer != null));
  }

  @ReactMethod
  public void analyzeBeatGrid(String filePath, double maxAnalyzeMs, Promise promise) {
    new Thread(() -> {
      try {
        AudioProfileAnalysis analysis = analyzeAudioProfileInternal(filePath, Math.max(10_000L, Math.round(maxAnalyzeMs)));
        WritableMap result = Arguments.createMap();
        result.putDouble("bpm", analysis.bpm);
        result.putDouble("beatIntervalMs", analysis.beatIntervalMs);
        result.putDouble("firstBeatOffsetMs", analysis.firstBeatOffsetMs);
        result.putDouble("confidence", analysis.confidence);
        result.putDouble("analyzedDurationMs", analysis.analyzedDurationMs);
        resolvePromise(promise, result);
      } catch (Exception e) {
        rejectPromise(promise, "MIXER_ANALYZE_FAILED", e);
      }
    }).start();
  }

  @ReactMethod
  public void analyzeMusicProfile(String filePath, double maxAnalyzeMs, Promise promise) {
    new Thread(() -> {
      try {
        AudioProfileAnalysis analysis = analyzeAudioProfileInternal(filePath, Math.max(10_000L, Math.round(maxAnalyzeMs)));
        WritableMap result = Arguments.createMap();
        result.putDouble("bpm", analysis.bpm);
        result.putDouble("beatIntervalMs", analysis.beatIntervalMs);
        result.putDouble("firstBeatOffsetMs", analysis.firstBeatOffsetMs);
        result.putDouble("confidence", analysis.confidence);
        result.putDouble("analyzedDurationMs", analysis.analyzedDurationMs);
        result.putString("majorKey", analysis.majorKey);
        result.putDouble("keyConfidence", analysis.keyConfidence);
        resolvePromise(promise, result);
      } catch (Exception e) {
        rejectPromise(promise, "MIXER_ANALYZE_PROFILE_FAILED", e);
      }
    }).start();
  }

  @Override
  public void invalidate() {
    runOnMixerThread(() -> {
      releaseInternal();
      mixerThread.quitSafely();
    });
    super.invalidate();
  }

  private ExoPlayer buildPlayer(String filePath, long positionMs, boolean playWhenReady, float volume) {
    ExoPlayer player = new ExoPlayer.Builder(reactContext).build();
    player.setMediaItem(MediaItem.fromUri(toUri(filePath)));
    player.setPlaybackParameters(new PlaybackParameters(playbackRate, pitch));
    player.setVolume(volume);
    player.setPlayWhenReady(playWhenReady);
    player.prepare();
    player.seekTo(positionMs);
    return player;
  }

  private Uri toUri(String filePath) {
    if (filePath.startsWith("content://") || filePath.startsWith("file://")) {
      return Uri.parse(filePath);
    }
    return Uri.fromFile(new File(filePath));
  }

  private float sanitizeVolume(float value) {
    if (value < 0f) return 0f;
    if (value > 1f) return 1f;
    return value;
  }

  private float sanitizeGain(float value) {
    if (value < 0.1f) return 0.1f;
    if (value > 3f) return 3f;
    return value;
  }

  private AudioProfileAnalysis analyzeAudioProfileInternal(String filePath, long maxAnalyzeMs) throws Exception {
    MediaExtractor extractor = new MediaExtractor();
    MediaCodec codec = null;
    try {
      extractor.setDataSource(filePath);
      int audioTrackIndex = -1;
      MediaFormat format = null;
      for (int i = 0; i < extractor.getTrackCount(); i++) {
        MediaFormat candidate = extractor.getTrackFormat(i);
        String mime = candidate.getString(MediaFormat.KEY_MIME);
        if (mime != null && mime.startsWith("audio/")) {
          audioTrackIndex = i;
          format = candidate;
          break;
        }
      }
      if (audioTrackIndex < 0 || format == null) throw new IllegalStateException("No audio track found");

      extractor.selectTrack(audioTrackIndex);
      String mime = format.getString(MediaFormat.KEY_MIME);
      if (mime == null) throw new IllegalStateException("Audio mime missing");

      int sampleRate = format.containsKey(MediaFormat.KEY_SAMPLE_RATE) ? format.getInteger(MediaFormat.KEY_SAMPLE_RATE) : 44100;
      int channelCount = format.containsKey(MediaFormat.KEY_CHANNEL_COUNT) ? format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : 2;

      codec = MediaCodec.createDecoderByType(mime);
      codec.configure(format, null, null, 0);
      codec.start();

      List<Double> frameEnergies = new ArrayList<>();
      double[] pitchClassEnergy = new double[12];
      double[] pitchWindow = new double[PITCH_FRAME_SAMPLES];
      MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
      boolean inputDone = false;
      boolean outputDone = false;
      int frameCount = 0;
      int pitchFrameCount = 0;
      double frameEnergy = 0;
      long analyzedDurationMs = 0L;

      while (!outputDone && analyzedDurationMs < maxAnalyzeMs) {
        if (!inputDone) {
          int inputIndex = codec.dequeueInputBuffer(10_000);
          if (inputIndex >= 0) {
            ByteBuffer inputBuffer = codec.getInputBuffer(inputIndex);
            if (inputBuffer == null) continue;
            int sampleSize = extractor.readSampleData(inputBuffer, 0);
            if (sampleSize < 0) {
              codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
              inputDone = true;
            } else {
              long presentationTimeUs = extractor.getSampleTime();
              codec.queueInputBuffer(inputIndex, 0, sampleSize, presentationTimeUs, 0);
              extractor.advance();
            }
          }
        }

        int outputIndex = codec.dequeueOutputBuffer(info, 10_000);
        if (outputIndex >= 0) {
          ByteBuffer outputBuffer = codec.getOutputBuffer(outputIndex);
          if (outputBuffer != null && info.size > 0) {
            outputBuffer.position(info.offset);
            outputBuffer.limit(info.offset + info.size);
            ByteBuffer pcmData = outputBuffer.slice().order(ByteOrder.LITTLE_ENDIAN);

            while (pcmData.remaining() >= channelCount * 2 && analyzedDurationMs < maxAnalyzeMs) {
              double mono = 0;
              for (int channel = 0; channel < channelCount && pcmData.remaining() >= 2; channel++) {
                mono += pcmData.getShort() / 32768.0;
              }
              mono /= channelCount;
              frameEnergy += mono * mono;
              frameCount++;
              pitchWindow[pitchFrameCount++] = mono;
              if (frameCount >= ANALYZE_FRAME_SAMPLES) {
                frameEnergies.add(frameEnergy / ANALYZE_FRAME_SAMPLES);
                analyzedDurationMs = Math.round(frameEnergies.size() * ANALYZE_FRAME_SAMPLES * 1000.0 / sampleRate);
                frameCount = 0;
                frameEnergy = 0;
              }
              if (pitchFrameCount >= PITCH_FRAME_SAMPLES) {
                accumulatePitchClassEnergy(pitchWindow, sampleRate, pitchClassEnergy);
                pitchFrameCount = 0;
              }
            }
          }

          codec.releaseOutputBuffer(outputIndex, false);
          if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true;
        }
      }

      if (frameCount > 0) frameEnergies.add(frameEnergy / Math.max(1, frameCount));
      AudioProfileAnalysis analysis = buildAudioProfileAnalysis(frameEnergies, sampleRate, pitchClassEnergy);
      analysis.analyzedDurationMs = Math.max(analysis.analyzedDurationMs, analyzedDurationMs);
      return analysis;
    } finally {
      try {
        extractor.release();
      } catch (Exception ignored) {}
      if (codec != null) {
        try {
          codec.stop();
        } catch (Exception ignored) {}
        try {
          codec.release();
        } catch (Exception ignored) {}
      }
    }
  }

  private void accumulatePitchClassEnergy(double[] samples, int sampleRate, double[] pitchClassEnergy) {
    double mean = 0;
    for (double sample : samples) mean += sample;
    mean /= samples.length;

    double energy = 0;
    double[] centered = new double[samples.length];
    for (int i = 0; i < samples.length; i++) {
      double value = samples[i] - mean;
      centered[i] = value;
      energy += value * value;
    }
    if (energy <= 1e-6) return;

    int minLag = Math.max(1, (int) Math.floor(sampleRate / MAX_PITCH_FREQ));
    int maxLag = Math.min(samples.length - 2, (int) Math.ceil(sampleRate / MIN_PITCH_FREQ));
    double bestScore = 0;
    int bestLag = -1;
    for (int lag = minLag; lag <= maxLag; lag++) {
      double score = 0;
      for (int i = 0; i < centered.length - lag; i++) {
        score += centered[i] * centered[i + lag];
      }
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    if (bestLag < 0 || bestScore <= 0) return;

    double freq = sampleRate / (double) bestLag;
    if (freq < MIN_PITCH_FREQ || freq > MAX_PITCH_FREQ) return;
    double midi = 69.0 + 12.0 * (Math.log(freq / 440.0) / Math.log(2.0));
    int pitchClass = ((int) Math.round(midi) % 12 + 12) % 12;
    pitchClassEnergy[pitchClass] += Math.sqrt(energy / centered.length);
  }

  private AudioProfileAnalysis buildAudioProfileAnalysis(List<Double> energies, int sampleRate, double[] pitchClassEnergy) {
    BeatAnalysis beatAnalysis = buildBeatAnalysis(energies, sampleRate);
    AudioProfileAnalysis analysis = new AudioProfileAnalysis();
    analysis.bpm = beatAnalysis.bpm;
    analysis.beatIntervalMs = beatAnalysis.beatIntervalMs;
    analysis.firstBeatOffsetMs = beatAnalysis.firstBeatOffsetMs;
    analysis.confidence = beatAnalysis.confidence;
    analysis.analyzedDurationMs = beatAnalysis.analyzedDurationMs;

    double totalPitchEnergy = 0;
    for (double value : pitchClassEnergy) totalPitchEnergy += value;
    if (totalPitchEnergy <= 1e-6) {
      analysis.majorKey = "未知";
      analysis.keyConfidence = 0;
      return analysis;
    }

    double bestScore = Double.NEGATIVE_INFINITY;
    double secondScore = Double.NEGATIVE_INFINITY;
    int bestKey = 0;
    for (int key = 0; key < 12; key++) {
      double score = 0;
      for (int i = 0; i < 12; i++) {
        score += pitchClassEnergy[(i + key) % 12] * MAJOR_KEY_PROFILE[i];
      }
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        bestKey = key;
      } else if (score > secondScore) {
        secondScore = score;
      }
    }
    analysis.majorKey = MAJOR_KEY_LABELS[bestKey];
    analysis.keyConfidence = bestScore <= 0 ? 0 : Math.max(0, Math.min(1, (bestScore - Math.max(0, secondScore)) / bestScore));
    return analysis;
  }

  private BeatAnalysis buildBeatAnalysis(List<Double> energies, int sampleRate) {
    if (energies.size() < 32) throw new IllegalStateException("Not enough audio frames for beat analysis");

    double[] envelope = new double[energies.size()];
    for (int i = 1; i < energies.size(); i++) {
      double delta = energies.get(i) - energies.get(i - 1);
      envelope[i] = Math.max(0, delta);
    }

    double frameDurationSec = ANALYZE_FRAME_SAMPLES / (double) sampleRate;
    int minLag = Math.max(1, (int) Math.round((60.0 / MAX_BPM) / frameDurationSec));
    int maxLag = Math.max(minLag + 1, (int) Math.round((60.0 / MIN_BPM) / frameDurationSec));

    double bestScore = -1;
    double secondScore = -1;
    int bestLag = minLag;
    for (int lag = minLag; lag <= maxLag; lag++) {
      double score = 0;
      for (int i = lag; i < envelope.length; i++) {
        score += envelope[i] * envelope[i - lag];
      }
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        bestLag = lag;
      } else if (score > secondScore) {
        secondScore = score;
      }
    }

    int bestOffset = 0;
    double bestOffsetScore = -1;
    for (int offset = 0; offset < bestLag; offset++) {
      double score = 0;
      for (int i = offset; i < envelope.length; i += bestLag) {
        score += envelope[i];
      }
      if (score > bestOffsetScore) {
        bestOffsetScore = score;
        bestOffset = offset;
      }
    }

    long beatIntervalMs = Math.max(1L, Math.round(bestLag * frameDurationSec * 1000.0));
    long firstBeatOffsetMs = Math.max(0L, Math.round(bestOffset * frameDurationSec * 1000.0));
    double bpm = 60_000.0 / beatIntervalMs;
    double confidence = bestScore <= 0 ? 0 : Math.max(0, Math.min(1, (bestScore - Math.max(0, secondScore)) / bestScore));
    long analyzedDurationMs = Math.round(envelope.length * frameDurationSec * 1000.0);

    BeatAnalysis analysis = new BeatAnalysis();
    analysis.bpm = bpm;
    analysis.beatIntervalMs = beatIntervalMs;
    analysis.firstBeatOffsetMs = firstBeatOffsetMs;
    analysis.confidence = confidence;
    analysis.analyzedDurationMs = analyzedDurationMs;
    return analysis;
  }

  private void watchSwitchPoint(long fadeDurationMs) {
    clearSwitchWatcher();
    if (activePlayer == null || standbyPlayer == null) return;

    switchWatcher = new Runnable() {
      @Override
      public void run() {
        if (activePlayer == null || standbyPlayer == null) return;
        if (!active) return;
        long currentPosition = activePlayer.getCurrentPosition();
        if (pendingSwitchAtMs <= currentPosition) {
          clearSwitchWatcher();
          runCrossfade(fadeDurationMs);
          return;
        }
        mixerHandler.postDelayed(this, POSITION_POLL_INTERVAL_MS);
      }
    };
    mixerHandler.post(switchWatcher);
  }

  private void runCrossfade(long fadeDurationMs) {
    clearFadeRunner();
    if (activePlayer == null || standbyPlayer == null) return;

    long startTimeMs = SystemClock.elapsedRealtime();
    ExoPlayer oldPlayer = activePlayer;
    ExoPlayer newPlayer = standbyPlayer;

    fadeRunner = new Runnable() {
      @Override
      public void run() {
        float progress = Math.min(1f, (SystemClock.elapsedRealtime() - startTimeMs) / (float) fadeDurationMs);
        oldPlayer.setVolume(outputVolume * activeTrackGain * (1f - progress));
        newPlayer.setVolume(outputVolume * standbyTrackGain * progress);

        if (progress >= 1f) {
          oldPlayer.stop();
          oldPlayer.release();
          activePlayer = newPlayer;
          activeTrackGain = standbyTrackGain;
          standbyPlayer = null;
          pendingSwitchAtMs = -1L;
          clearFadeRunner();
          applyVolumes();
          return;
        }
        mixerHandler.postDelayed(this, POSITION_POLL_INTERVAL_MS);
      }
    };
    mixerHandler.post(fadeRunner);
  }

  private void applyVolumes() {
    if (activePlayer != null) activePlayer.setVolume(outputVolume * activeTrackGain);
    if (standbyPlayer != null && pendingSwitchAtMs > -1L) standbyPlayer.setVolume(0f);
    else if (standbyPlayer != null) standbyPlayer.setVolume(outputVolume * standbyTrackGain);
  }

  private void applyPlaybackParameters() {
    PlaybackParameters params = new PlaybackParameters(playbackRate, pitch);
    if (activePlayer != null) activePlayer.setPlaybackParameters(params);
    if (standbyPlayer != null) standbyPlayer.setPlaybackParameters(params);
  }

  private void clearSwitchWatcher() {
    if (switchWatcher != null) {
      mixerHandler.removeCallbacks(switchWatcher);
      switchWatcher = null;
    }
  }

  private void clearFadeRunner() {
    if (fadeRunner != null) {
      mixerHandler.removeCallbacks(fadeRunner);
      fadeRunner = null;
    }
  }

  private void releaseInternal() {
    clearSwitchWatcher();
    clearFadeRunner();
    pendingSwitchAtMs = -1L;
    active = false;
    activeTrackGain = 1.0f;
    standbyTrackGain = 1.0f;
    transitionFadeDurationMs = 120L;
    if (activePlayer != null) {
      activePlayer.release();
      activePlayer = null;
    }
    if (standbyPlayer != null) {
      standbyPlayer.release();
      standbyPlayer = null;
    }
  }

  private void runOnMixerThread(Runnable runnable) {
    if (Looper.myLooper() == mixerThread.getLooper()) {
      runnable.run();
      return;
    }
    mixerHandler.post(runnable);
  }

  private void resolvePromise(Promise promise, @Nullable Object value) {
    reactContext.runOnNativeModulesQueueThread(() -> promise.resolve(value));
  }

  private void rejectPromise(Promise promise, String code, Exception error) {
    reactContext.runOnNativeModulesQueueThread(() -> promise.reject(code, error));
  }

  private static class BeatAnalysis {
    double bpm;
    long beatIntervalMs;
    long firstBeatOffsetMs;
    double confidence;
    long analyzedDurationMs;
  }

  private static class AudioProfileAnalysis extends BeatAnalysis {
    String majorKey;
    double keyConfidence;
  }
}
