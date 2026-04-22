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
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MixerModule extends ReactContextBaseJavaModule {
  private static final long POSITION_POLL_INTERVAL_MS = 16L;
  private static final long SEEK_RESUME_DELAY_MS = 80L;
  private static final int ANALYZE_FRAME_SAMPLES = 1024;
  private static final int PITCH_FRAME_SAMPLES = 2048;
  private static final int MAX_WAVEFORM_SAMPLES = 144;
  private static final long CHORD_SEGMENT_MS = 560L;
  private static final long MIN_CHORD_EVENT_MS = 360L;
  private static final long MAX_BRIDGE_SEGMENT_MS = 620L;
  private static final int MIN_BPM = 70;
  private static final int MAX_BPM = 180;
  private static final double MIN_PITCH_FREQ = 80.0;
  private static final double MAX_PITCH_FREQ = 1000.0;
  private static final double SPECTRAL_MIN_FREQ = 55.0;
  private static final double SPECTRAL_MAX_FREQ = 1760.0;
  private static final int SPECTRAL_HARMONICS = 4;
  private static final double SPECTRAL_CHROMA_WEIGHT = 0.92;
  private static final double MELODY_PITCH_CLASS_WEIGHT = 0.38;
  private static final String[] NOTE_LABELS = {
    "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"
  };
  private static final String[] MAJOR_KEY_LABELS = {
    "C调", "#C调", "D调", "bE调", "E调", "F调", "#F调", "G调", "bA调", "A调", "bB调", "B调"
  };
  private static final String[] MINOR_KEY_LABELS = {
    "C小调", "#C小调", "D小调", "bE小调", "E小调", "F小调", "#F小调", "G小调", "bA小调", "A小调", "bB小调", "B小调"
  };
  private static final double[] MAJOR_KEY_PROFILE = {
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88
  };
  private static final double[] MINOR_KEY_PROFILE = {
    6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17
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
        if (analysis.keyMode != null) result.putString("keyMode", analysis.keyMode);
        if (analysis.keyTonic != null) result.putString("keyTonic", analysis.keyTonic);
        if (analysis.highestNote != null) result.putString("highestNote", analysis.highestNote);
        if (!Double.isNaN(analysis.highestMidi)) result.putDouble("highestMidi", analysis.highestMidi);
        if (!Double.isNaN(analysis.highestFreqHz)) result.putDouble("highestFreqHz", analysis.highestFreqHz);
        if (!Double.isNaN(analysis.highestTimeMs)) result.putDouble("highestTimeMs", analysis.highestTimeMs);
        if (analysis.dominantHighNote != null) result.putString("dominantHighNote", analysis.dominantHighNote);
        if (analysis.dominantLowNote != null) result.putString("dominantLowNote", analysis.dominantLowNote);
        if (analysis.averageNote != null) result.putString("averageNote", analysis.averageNote);
        if (!Double.isNaN(analysis.averageMidi)) result.putDouble("averageMidi", analysis.averageMidi);
        if (analysis.commonHighNote != null) result.putString("commonHighNote", analysis.commonHighNote);
        if (!Double.isNaN(analysis.commonHighMidi)) result.putDouble("commonHighMidi", analysis.commonHighMidi);
        if (analysis.commonLowNote != null) result.putString("commonLowNote", analysis.commonLowNote);
        if (!Double.isNaN(analysis.commonLowMidi)) result.putDouble("commonLowMidi", analysis.commonLowMidi);
        if (analysis.lowestNote != null) result.putString("lowestNote", analysis.lowestNote);
        if (!Double.isNaN(analysis.lowestMidi)) result.putDouble("lowestMidi", analysis.lowestMidi);
        if (!Double.isNaN(analysis.lowestFreqHz)) result.putDouble("lowestFreqHz", analysis.lowestFreqHz);
        if (!Double.isNaN(analysis.lowestTimeMs)) result.putDouble("lowestTimeMs", analysis.lowestTimeMs);
        if (analysis.timeSignature != null) result.putString("timeSignature", analysis.timeSignature);
        if (analysis.waveformSamples != null && analysis.waveformSamples.length > 0) {
          WritableArray waveformArray = Arguments.createArray();
          for (double sample : analysis.waveformSamples) waveformArray.pushDouble(sample);
          result.putArray("waveformSamples", waveformArray);
        }
        if (analysis.pitchTrack != null && !analysis.pitchTrack.isEmpty()) {
          WritableArray pitchTrackArray = Arguments.createArray();
          for (PitchFrameData frame : analysis.pitchTrack) {
            WritableMap frameMap = Arguments.createMap();
            frameMap.putDouble("timeMs", frame.timeMs);
            frameMap.putDouble("midi", frame.midi);
            pitchTrackArray.pushMap(frameMap);
          }
          result.putArray("pitchTrack", pitchTrackArray);
        }
        if (analysis.chordSegments != null && !analysis.chordSegments.isEmpty()) {
          WritableArray segmentArray = Arguments.createArray();
          for (ChordSegment segment : analysis.chordSegments) {
            WritableMap segmentMap = Arguments.createMap();
            segmentMap.putDouble("startMs", segment.startMs);
            segmentMap.putDouble("endMs", segment.endMs);
            segmentMap.putString("label", segment.label);
            segmentMap.putDouble("confidence", segment.confidence);
            segmentArray.pushMap(segmentMap);
          }
          result.putArray("chordSegments", segmentArray);
        }
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
      double[] pitchNoteEnergy = new double[128];
      double[] currentSegmentPitchClass = new double[12];
      List<SegmentPitchClassData> segmentPitchClasses = new ArrayList<>();
      List<PitchFrameData> pitchFrames = new ArrayList<>();
      long processedSamples = 0L;
      long currentSegmentStartMs = 0L;
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
              processedSamples += 1;
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
                long pitchTimeMs = Math.round(processedSamples * 1000.0 / sampleRate);
                accumulatePitchClassEnergy(pitchWindow, sampleRate, pitchClassEnergy, pitchNoteEnergy, currentSegmentPitchClass, pitchTimeMs, pitchFrames);
                pitchFrameCount = 0;
              }
              long currentTimeMs = Math.round(processedSamples * 1000.0 / sampleRate);
              if (currentTimeMs - currentSegmentStartMs >= CHORD_SEGMENT_MS) {
                SegmentPitchClassData segment = createSegmentPitchClassData(currentSegmentPitchClass, currentSegmentStartMs, currentTimeMs);
                if (segment != null) segmentPitchClasses.add(segment);
                currentSegmentPitchClass = new double[12];
                currentSegmentStartMs = currentTimeMs;
              }
            }
          }

          codec.releaseOutputBuffer(outputIndex, false);
          if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true;
        }
      }

      if (frameCount > 0) frameEnergies.add(frameEnergy / Math.max(1, frameCount));
      long finalTimeMs = Math.round(processedSamples * 1000.0 / sampleRate);
      if (finalTimeMs > currentSegmentStartMs) {
        SegmentPitchClassData segment = createSegmentPitchClassData(currentSegmentPitchClass, currentSegmentStartMs, finalTimeMs);
        if (segment != null) segmentPitchClasses.add(segment);
      }

      AudioProfileAnalysis analysis = buildAudioProfileAnalysis(frameEnergies, sampleRate, pitchClassEnergy, pitchNoteEnergy, segmentPitchClasses, pitchFrames);
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

  private void accumulatePitchClassEnergy(double[] samples, int sampleRate, double[] pitchClassEnergy, double[] pitchNoteEnergy, double[] currentSegmentPitchClass, long currentTimeMs, List<PitchFrameData> pitchFrames) {
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

    accumulateSpectralPitchClassEnergy(centered, sampleRate, pitchClassEnergy, currentSegmentPitchClass);

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
    double weightedEnergy = Math.sqrt(energy / centered.length);
    pitchClassEnergy[pitchClass] += weightedEnergy * MELODY_PITCH_CLASS_WEIGHT;
    currentSegmentPitchClass[pitchClass] += weightedEnergy * MELODY_PITCH_CLASS_WEIGHT;
    int midiIndex = Math.max(0, Math.min(pitchNoteEnergy.length - 1, (int) Math.round(midi)));
    pitchNoteEnergy[midiIndex] += weightedEnergy;
    PitchFrameData pitchFrame = new PitchFrameData();
    pitchFrame.timeMs = currentTimeMs;
    pitchFrame.midi = midi;
    pitchFrame.frequencyHz = freq;
    pitchFrame.weight = weightedEnergy;
    pitchFrames.add(pitchFrame);
  }

  private void accumulateSpectralPitchClassEnergy(double[] centered, int sampleRate, double[] pitchClassEnergy, double[] currentSegmentPitchClass) {
    int size = centered.length;
    if (size <= 0 || (size & (size - 1)) != 0) return;

    double[] real = new double[size];
    double[] imag = new double[size];
    for (int i = 0; i < size; i++) {
      double window = 0.5 - 0.5 * Math.cos((2.0 * Math.PI * i) / Math.max(1, size - 1));
      real[i] = centered[i] * window;
    }
    fft(real, imag);

    double[] chroma = new double[12];
    for (int bin = 1; bin < size / 2; bin++) {
      double freq = bin * sampleRate / (double) size;
      if (freq < SPECTRAL_MIN_FREQ || freq > SPECTRAL_MAX_FREQ) continue;
      double magnitude = Math.hypot(real[bin], imag[bin]);
      if (magnitude <= 1e-6) continue;
      double energy = Math.log1p(magnitude);
      for (int harmonic = 1; harmonic <= SPECTRAL_HARMONICS; harmonic++) {
        double harmonicFreq = freq * harmonic;
        if (harmonicFreq > SPECTRAL_MAX_FREQ) break;
        double midi = 69.0 + 12.0 * (Math.log(harmonicFreq / 440.0) / Math.log(2.0));
        int pitchClass = ((int) Math.round(midi) % 12 + 12) % 12;
        chroma[pitchClass] += energy / Math.pow(harmonic, 1.12);
      }
    }

    double total = 0;
    double maxValue = 0;
    for (double value : chroma) {
      total += value;
      maxValue = Math.max(maxValue, value);
    }
    if (total <= 1e-6 || maxValue <= 1e-6) return;

    double mean = total / chroma.length;
    for (int pitchClass = 0; pitchClass < chroma.length; pitchClass++) {
      double normalized = Math.max(0, chroma[pitchClass] - mean * 0.35) / maxValue;
      if (normalized <= 1e-5) continue;
      double weighted = normalized * SPECTRAL_CHROMA_WEIGHT;
      pitchClassEnergy[pitchClass] += weighted;
      currentSegmentPitchClass[pitchClass] += weighted;
    }
  }

  private void fft(double[] real, double[] imag) {
    int n = real.length;
    if (n <= 1) return;

    int levels = 31 - Integer.numberOfLeadingZeros(n);
    for (int i = 0; i < n; i++) {
      int j = Integer.reverse(i) >>> (32 - levels);
      if (j > i) {
        double tempReal = real[i];
        real[i] = real[j];
        real[j] = tempReal;
        double tempImag = imag[i];
        imag[i] = imag[j];
        imag[j] = tempImag;
      }
    }

    for (int size = 2; size <= n; size <<= 1) {
      int halfSize = size >>> 1;
      double phaseStep = -2.0 * Math.PI / size;
      for (int start = 0; start < n; start += size) {
        for (int offset = 0; offset < halfSize; offset++) {
          double angle = phaseStep * offset;
          double cos = Math.cos(angle);
          double sin = Math.sin(angle);
          int evenIndex = start + offset;
          int oddIndex = evenIndex + halfSize;
          double oddReal = real[oddIndex] * cos - imag[oddIndex] * sin;
          double oddImag = real[oddIndex] * sin + imag[oddIndex] * cos;
          real[oddIndex] = real[evenIndex] - oddReal;
          imag[oddIndex] = imag[evenIndex] - oddImag;
          real[evenIndex] += oddReal;
          imag[evenIndex] += oddImag;
        }
      }
    }
  }

  private AudioProfileAnalysis buildAudioProfileAnalysis(List<Double> energies, int sampleRate, double[] pitchClassEnergy, double[] pitchNoteEnergy, List<SegmentPitchClassData> segmentPitchClasses, List<PitchFrameData> pitchFrames) {
    BeatAnalysis beatAnalysis = buildBeatAnalysis(energies, sampleRate);
    AudioProfileAnalysis analysis = new AudioProfileAnalysis();
    analysis.bpm = beatAnalysis.bpm;
    analysis.beatIntervalMs = beatAnalysis.beatIntervalMs;
    analysis.firstBeatOffsetMs = beatAnalysis.firstBeatOffsetMs;
    analysis.confidence = beatAnalysis.confidence;
    analysis.analyzedDurationMs = beatAnalysis.analyzedDurationMs;
    analysis.timeSignature = beatAnalysis.timeSignature;
    analysis.chordSegments = new ArrayList<>();
    analysis.waveformSamples = buildWaveformSamples(energies);
    analysis.pitchTrack = buildPitchTrackSamples(pitchFrames);

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
    String bestMode = "major";
    for (int key = 0; key < 12; key++) {
      double majorScore = 0;
      for (int i = 0; i < 12; i++) {
        majorScore += pitchClassEnergy[(i + key) % 12] * MAJOR_KEY_PROFILE[i];
      }
      if (majorScore > bestScore) {
        secondScore = bestScore;
        bestScore = majorScore;
        bestKey = key;
        bestMode = "major";
      } else if (majorScore > secondScore) {
        secondScore = majorScore;
      }

      double minorScore = 0;
      for (int i = 0; i < 12; i++) {
        minorScore += pitchClassEnergy[(i + key) % 12] * MINOR_KEY_PROFILE[i];
      }
      if (minorScore > bestScore) {
        secondScore = bestScore;
        bestScore = minorScore;
        bestKey = key;
        bestMode = "minor";
      } else if (minorScore > secondScore) {
        secondScore = minorScore;
      }
    }
    analysis.keyMode = bestMode;
    analysis.keyTonic = NOTE_LABELS[bestKey];
    analysis.majorKey = "minor".equals(bestMode) ? MINOR_KEY_LABELS[bestKey] : MAJOR_KEY_LABELS[bestKey];
    analysis.keyConfidence = bestScore <= 0 ? 0 : Math.max(0, Math.min(1, (bestScore - Math.max(0, secondScore)) / bestScore));
    analysis.chordSegments = inferChordSegments(segmentPitchClasses, bestKey, bestMode, beatAnalysis);
    if (!analysis.chordSegments.isEmpty()) {
      BeatAlignedChordResult beatAlignedChordResult = alignChordSegmentsToBeatGrid(
        analysis.chordSegments,
        beatAnalysis,
        analysis.analyzedDurationMs,
        bestKey,
        bestMode
      );
      if (!beatAlignedChordResult.segments.isEmpty()) {
        analysis.chordSegments = beatAlignedChordResult.segments;
      }
      if (beatAlignedChordResult.timeSignature != null) {
        analysis.timeSignature = beatAlignedChordResult.timeSignature;
      }
    }

    double strongestNoteEnergy = 0;
    for (double value : pitchNoteEnergy) strongestNoteEnergy = Math.max(strongestNoteEnergy, value);
    if (strongestNoteEnergy > 1e-6) {
      analysis.dominantHighNote = pickDominantNote(pitchNoteEnergy, 67, 127);
      analysis.dominantLowNote = pickDominantNote(pitchNoteEnergy, 0, 60);
      analysis.averageMidi = computeWeightedAverageMidi(pitchNoteEnergy);
      if (!Double.isNaN(analysis.averageMidi)) analysis.averageNote = toNoteName((int) Math.round(analysis.averageMidi));
      int commonHighMidi = pickPercentileMidi(pitchNoteEnergy, 0.82);
      int commonLowMidi = pickPercentileMidi(pitchNoteEnergy, 0.18);
      if (commonHighMidi >= 0) {
        analysis.commonHighMidi = commonHighMidi;
        analysis.commonHighNote = toNoteName(commonHighMidi);
      }
      if (commonLowMidi >= 0) {
        analysis.commonLowMidi = commonLowMidi;
        analysis.commonLowNote = toNoteName(commonLowMidi);
      }
      int highestMidi = -1;
      int lowestMidi = -1;
      double threshold = strongestNoteEnergy * 0.18;
      for (int midi = pitchNoteEnergy.length - 1; midi >= 0; midi--) {
        if (pitchNoteEnergy[midi] >= threshold) {
          highestMidi = midi;
          break;
        }
      }
      for (int midi = 0; midi < pitchNoteEnergy.length; midi++) {
        if (pitchNoteEnergy[midi] >= threshold) {
          lowestMidi = midi;
          break;
        }
      }
      if (highestMidi >= 0) {
        analysis.highestMidi = highestMidi;
        analysis.highestFreqHz = 440.0 * Math.pow(2.0, (highestMidi - 69.0) / 12.0);
        analysis.highestNote = toNoteName(highestMidi);
        analysis.highestTimeMs = findExtremePitchTime(pitchFrames, highestMidi, true);
      }
      if (lowestMidi >= 0) {
        analysis.lowestMidi = lowestMidi;
        analysis.lowestFreqHz = 440.0 * Math.pow(2.0, (lowestMidi - 69.0) / 12.0);
        analysis.lowestNote = toNoteName(lowestMidi);
        analysis.lowestTimeMs = findExtremePitchTime(pitchFrames, lowestMidi, false);
      }
    }
    return analysis;
  }

  private double[] buildWaveformSamples(List<Double> energies) {
    if (energies.isEmpty()) return new double[0];
    int targetCount = Math.min(MAX_WAVEFORM_SAMPLES, Math.max(24, energies.size()));
    double[] samples = new double[targetCount];
    double maxValue = 0;
    for (int i = 0; i < targetCount; i++) {
      int start = (int) Math.floor(i * energies.size() / (double) targetCount);
      int end = (int) Math.floor((i + 1) * energies.size() / (double) targetCount);
      if (end <= start) end = Math.min(energies.size(), start + 1);
      double bucketMax = 0;
      for (int j = start; j < end; j++) bucketMax = Math.max(bucketMax, Math.sqrt(Math.max(0, energies.get(j))));
      samples[i] = bucketMax;
      maxValue = Math.max(maxValue, bucketMax);
    }
    if (maxValue <= 1e-6) return samples;
    for (int i = 0; i < samples.length; i++) samples[i] = Math.max(0, Math.min(1, samples[i] / maxValue));
    return samples;
  }

  private List<PitchFrameData> buildPitchTrackSamples(List<PitchFrameData> pitchFrames) {
    if (pitchFrames == null || pitchFrames.isEmpty()) return new ArrayList<>();
    int targetCount = Math.min(360, pitchFrames.size());
    List<PitchFrameData> output = new ArrayList<>(targetCount);
    for (int i = 0; i < targetCount; i++) {
      int index = (int) Math.floor(i * pitchFrames.size() / (double) targetCount);
      if (index >= pitchFrames.size()) index = pitchFrames.size() - 1;
      output.add(pitchFrames.get(index));
    }
    return output;
  }

  private double computeWeightedAverageMidi(double[] pitchNoteEnergy) {
    double weighted = 0;
    double total = 0;
    for (int midi = 0; midi < pitchNoteEnergy.length; midi++) {
      double value = pitchNoteEnergy[midi];
      if (value <= 0) continue;
      weighted += midi * value;
      total += value;
    }
    return total <= 1e-6 ? Double.NaN : weighted / total;
  }

  private int pickPercentileMidi(double[] pitchNoteEnergy, double percentile) {
    double total = 0;
    for (double value : pitchNoteEnergy) total += value;
    if (total <= 1e-6) return -1;
    double threshold = total * Math.max(0, Math.min(1, percentile));
    double accum = 0;
    for (int midi = 0; midi < pitchNoteEnergy.length; midi++) {
      accum += pitchNoteEnergy[midi];
      if (accum >= threshold) return midi;
    }
    return pitchNoteEnergy.length - 1;
  }

  private double findExtremePitchTime(List<PitchFrameData> pitchFrames, int targetMidi, boolean preferHigh) {
    if (pitchFrames == null || pitchFrames.isEmpty()) return Double.NaN;
    PitchFrameData best = null;
    double bestScore = Double.NEGATIVE_INFINITY;
    for (PitchFrameData frame : pitchFrames) {
      int roundedMidi = (int) Math.round(frame.midi);
      if (Math.abs(roundedMidi - targetMidi) > 1) continue;
      double score = frame.weight * 10 + (preferHigh ? frame.midi : -frame.midi);
      if (score > bestScore) {
        bestScore = score;
        best = frame;
      }
    }
    if (best != null) return best.timeMs;
    PitchFrameData fallback = pitchFrames.get(0);
    double fallbackDistance = Math.abs(fallback.midi - targetMidi);
    for (PitchFrameData frame : pitchFrames) {
      double distance = Math.abs(frame.midi - targetMidi);
      if (distance < fallbackDistance) {
        fallbackDistance = distance;
        fallback = frame;
      }
    }
    return fallback.timeMs;
  }

  private SegmentPitchClassData createSegmentPitchClassData(double[] pitchClassEnergy, long startMs, long endMs) {
    double total = 0;
    for (double value : pitchClassEnergy) total += value;
    if (total <= 1e-6 || endMs <= startMs) return null;
    SegmentPitchClassData data = new SegmentPitchClassData();
    data.startMs = startMs;
    data.endMs = endMs;
    data.pitchClassEnergy = Arrays.copyOf(pitchClassEnergy, pitchClassEnergy.length);
    return data;
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
    double[] lagScores = new double[maxLag + 1];
    for (int lag = minLag; lag <= maxLag; lag++) {
      double score = 0;
      for (int i = lag; i < envelope.length; i++) {
        score += envelope[i] * envelope[i - lag];
      }
      lagScores[lag] = score;
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        bestLag = lag;
      } else if (score > secondScore) {
        secondScore = score;
      }
    }

    int correctedLag = bestLag;
    int slowerLag = bestLag * 2;
    if (slowerLag <= maxLag) {
      double slowerScore = lagScores[slowerLag];
      double fasterBpm = 60.0 / (bestLag * frameDurationSec);
      double slowerBpm = 60.0 / (slowerLag * frameDurationSec);
      if (fasterBpm >= 108.0 && slowerBpm >= 55.0 && slowerScore >= bestScore * 0.84) {
        correctedLag = slowerLag;
        bestScore = slowerScore;
      }
    }
    bestLag = correctedLag;

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
    analysis.timeSignature = inferTimeSignature(envelope, bestLag);
    return analysis;
  }

  private String inferTimeSignature(double[] envelope, int beatLag) {
    double triple = computeMeterScore(envelope, beatLag, 3);
    double quadruple = computeMeterScore(envelope, beatLag, 4);
    if (triple > quadruple * 1.08) {
      return beatLag <= 12 ? "6/8" : "3/4";
    }
    return "4/4";
  }

  private double computeMeterScore(double[] envelope, int beatLag, int meter) {
    if (beatLag <= 0 || envelope.length <= beatLag * meter) return 0;
    double score = 0;
    int groups = 0;
    for (int groupStart = 0; groupStart + beatLag * meter < envelope.length; groupStart += beatLag * meter) {
      double first = 0;
      double rest = 0;
      for (int step = 0; step < meter; step++) {
        int index = groupStart + step * beatLag;
        if (index >= envelope.length) break;
        if (step == 0) first += envelope[index];
        else rest += envelope[index];
      }
      score += Math.max(0, first - (rest / Math.max(1, meter - 1)));
      groups += 1;
    }
    return groups == 0 ? 0 : score / groups;
  }

  private List<ChordSegment> inferChordSegments(List<SegmentPitchClassData> segmentPitchClasses, int keyRoot, String mode, BeatAnalysis beatAnalysis) {
    List<ChordSegment> resolved = new ArrayList<>();
    if (segmentPitchClasses == null || segmentPitchClasses.isEmpty()) return resolved;

    int[][] chordTemplates = new int[][] {
      {0, 4, 7},
      {0, 3, 7},
      {0, 3, 6},
      {0, 4, 7, 10},
      {0, 4, 7, 11},
      {0, 3, 7, 10},
    };
    String[] chordSuffixes = new String[] {"", "m", "dim", "7", "maj7", "m7"};

    List<List<ChordCandidate>> candidateRows = new ArrayList<>();
    for (SegmentPitchClassData segment : segmentPitchClasses) {
      List<ChordCandidate> candidates = new ArrayList<>();
      for (int root = 0; root < 12; root++) {
        for (int type = 0; type < chordTemplates.length; type++) {
          double score = scoreChordCandidate(segment.pitchClassEnergy, root, chordTemplates[type], chordSuffixes[type], keyRoot, mode);
          ChordCandidate candidate = new ChordCandidate();
          candidate.root = root;
          candidate.suffix = chordSuffixes[type];
          candidate.baseScore = score;
          candidate.label = NOTE_LABELS[root] + chordSuffixes[type];
          candidates.add(candidate);
        }
      }
      candidates.sort((a, b) -> Double.compare(b.baseScore, a.baseScore));
      int limit = Math.min(12, candidates.size());
      List<ChordCandidate> topCandidates = new ArrayList<>();
      for (int i = 0; i < limit; i++) {
        ChordCandidate candidate = candidates.get(i);
        candidate.pathScore = candidate.baseScore;
        topCandidates.add(candidate);
      }
      candidateRows.add(topCandidates);
    }

    for (int rowIndex = 1; rowIndex < candidateRows.size(); rowIndex++) {
      List<ChordCandidate> currentRow = candidateRows.get(rowIndex);
      List<ChordCandidate> prevRow = candidateRows.get(rowIndex - 1);
      for (ChordCandidate current : currentRow) {
        double bestPathScore = Double.NEGATIVE_INFINITY;
        ChordCandidate bestPrev = null;
        for (ChordCandidate previous : prevRow) {
          double pathScore = previous.pathScore + current.baseScore + computeTransitionBonus(previous, current, keyRoot, mode);
          if (pathScore > bestPathScore) {
            bestPathScore = pathScore;
            bestPrev = previous;
          }
        }
        current.pathScore = bestPrev == null ? current.baseScore : bestPathScore;
        current.prev = bestPrev;
      }
    }

    List<ChordCandidate> lastRow = candidateRows.get(candidateRows.size() - 1);
    ChordCandidate best = lastRow.get(0);
    for (ChordCandidate candidate : lastRow) {
      if (candidate.pathScore > best.pathScore) best = candidate;
    }

    ChordCandidate[] resolvedCandidates = new ChordCandidate[candidateRows.size()];
    for (int index = resolvedCandidates.length - 1; index >= 0 && best != null; index--) {
      resolvedCandidates[index] = best;
      best = best.prev;
    }

    for (int index = 0; index < resolvedCandidates.length; index++) {
      ChordCandidate candidate = resolvedCandidates[index];
      if (candidate == null) continue;
      SegmentPitchClassData segment = segmentPitchClasses.get(index);
      ChordSegment output = new ChordSegment();
      output.startMs = segment.startMs;
      output.endMs = segment.endMs;
      output.label = candidate.label;
      output.confidence = Math.max(0, Math.min(1, 0.18 + (candidate.baseScore / Math.max(1e-6, 2.6 + sumPitchEnergy(segment.pitchClassEnergy)))));
      resolved.add(output);
    }
    return postProcessChordSegments(resolved, beatAnalysis);
  }

  private double scoreChordCandidate(double[] segmentPitchClassEnergy, int root, int[] template, String suffix, int keyRoot, String mode) {
    double total = sumPitchEnergy(segmentPitchClassEnergy);
    if (total <= 1e-6) return Double.NEGATIVE_INFINITY;

    boolean[] mask = new boolean[12];
    for (int interval : template) mask[(root + interval) % 12] = true;

    double[] normalized = new double[12];
    for (int pc = 0; pc < 12; pc++) normalized[pc] = segmentPitchClassEnergy[pc] / total;

    double inChordEnergy = 0;
    double outOfChordEnergy = 0;
    for (int pc = 0; pc < 12; pc++) {
      double energy = normalized[pc];
      if (energy <= 0) continue;
      if (mask[pc]) inChordEnergy += energy;
      else outOfChordEnergy += energy;
    }
    double score = inChordEnergy * 1.35 - outOfChordEnergy * 0.82;
    double thirdSupport = getThirdSupport(normalized, root, suffix);
    double fifthSupport = getFifthSupport(normalized, root, suffix);
    double seventhSupport = getSeventhSupport(normalized, root, suffix);
    score += normalized[root] * 0.72;
    score += thirdSupport * 0.54;
    score += fifthSupport * 0.32;
    score += seventhSupport * 0.14;
    score += computeChordQualityPenalty(suffix, thirdSupport, fifthSupport, seventhSupport);
    score += computeDiatonicBonus(root, suffix, keyRoot, mode);
    return score;
  }

  private double computeChordQualityPenalty(String suffix, double thirdSupport, double fifthSupport, double seventhSupport) {
    if ("7".equals(suffix) || "maj7".equals(suffix) || "m7".equals(suffix)) {
      if (seventhSupport < 0.12) return -0.22;
      if (seventhSupport < 0.18) return -0.08;
      return 0.03;
    }
    if ("dim".equals(suffix)) {
      if (thirdSupport < 0.14 || fifthSupport < 0.1) return -0.26;
      return -0.04;
    }
    if (thirdSupport < 0.09 || fifthSupport < 0.08) return -0.06;
    return 0;
  }

  private double getThirdSupport(double[] segmentPitchClassEnergy, int root, String suffix) {
    boolean useMinorThird = "m".equals(suffix) || "m7".equals(suffix) || "dim".equals(suffix);
    int third = root + (useMinorThird ? 3 : 4);
    return segmentPitchClassEnergy[third % 12];
  }

  private double getFifthSupport(double[] segmentPitchClassEnergy, int root, String suffix) {
    int fifth = root + ("dim".equals(suffix) ? 6 : 7);
    return segmentPitchClassEnergy[fifth % 12];
  }

  private double getSeventhSupport(double[] segmentPitchClassEnergy, int root, String suffix) {
    if ("7".equals(suffix) || "m7".equals(suffix)) return segmentPitchClassEnergy[(root + 10) % 12];
    if ("maj7".equals(suffix)) return segmentPitchClassEnergy[(root + 11) % 12];
    return 0;
  }

  private double computeDiatonicBonus(int root, String suffix, int keyRoot, String mode) {
    int majorSystemRoot = "minor".equals(mode) ? (keyRoot + 3) % 12 : keyRoot;
    int interval = (root - majorSystemRoot + 12) % 12;
    switch (interval) {
      case 0:
        return "".equals(suffix) || "maj7".equals(suffix) ? 0.42 : 0.16;
      case 2:
      case 4:
      case 9:
        return "m".equals(suffix) || "m7".equals(suffix) ? 0.36 : -0.18;
      case 5:
      case 7:
        return "".equals(suffix) || "7".equals(suffix) || "maj7".equals(suffix) ? 0.31 : -0.12;
      case 11:
        return "dim".equals(suffix) ? 0.26 : -0.24;
      default:
        return -0.14;
    }
  }

  private double computeTransitionBonus(ChordCandidate previous, ChordCandidate current, int keyRoot, String mode) {
    if (previous == null || current == null) return 0;
    if (previous.label.equals(current.label)) return 0.02;

    int majorSystemRoot = "minor".equals(mode) ? (keyRoot + 3) % 12 : keyRoot;
    int prevDegree = (previous.root - majorSystemRoot + 12) % 12;
    int currentDegree = (current.root - majorSystemRoot + 12) % 12;
    if (prevDegree == 7 && currentDegree == 0) return 0.24;
    if (prevDegree == 5 && currentDegree == 7) return 0.16;
    if (prevDegree == 9 && (currentDegree == 5 || currentDegree == 7 || currentDegree == 0)) return 0.1;
    if (prevDegree == 2 && currentDegree == 7) return 0.12;
    if (Math.abs(previous.root - current.root) <= 2 && previous.suffix.equals(current.suffix)) return 0.06;
    if (previous.suffix.equals(current.suffix)) return 0.02;
    return -0.05;
  }

  private double sumPitchEnergy(double[] pitchClassEnergy) {
    double total = 0;
    for (double value : pitchClassEnergy) total += value;
    return total;
  }

  private List<ChordSegment> postProcessChordSegments(List<ChordSegment> segments, BeatAnalysis beatAnalysis) {
    long beatIntervalMs = beatAnalysis == null || beatAnalysis.beatIntervalMs <= 0
      ? 560L
      : Math.max(360L, beatAnalysis.beatIntervalMs);
    List<ChordSegment> merged = mergeAdjacentChordSegments(segments);
    merged = absorbBridgeSegments(merged, beatIntervalMs);
    merged = mergeAdjacentChordSegments(merged);
    merged = absorbWeakShortSegments(merged, beatIntervalMs);
    return mergeAdjacentChordSegments(merged);
  }

  private BeatAlignedChordResult alignChordSegmentsToBeatGrid(
    List<ChordSegment> segments,
    BeatAnalysis beatAnalysis,
    long analyzedDurationMs,
    int keyRoot,
    String mode
  ) {
    BeatAlignedChordResult result = new BeatAlignedChordResult();
    result.segments = new ArrayList<>(segments);
    result.timeSignature = beatAnalysis == null ? null : beatAnalysis.timeSignature;
    if (segments == null || segments.isEmpty() || beatAnalysis == null || beatAnalysis.beatIntervalMs <= 0) {
      return result;
    }

    List<Long> beatTimes = buildBeatTimes(beatAnalysis, analyzedDurationMs, segments.get(segments.size() - 1).endMs);
    if (beatTimes.size() < 2) return result;

    List<String> chordSeries = synchronizeChordSeriesToBeats(segments, beatTimes);
    if (chordSeries.isEmpty()) return result;

    DownbeatScore triple = scoreDownbeatAlignment(chordSeries, 3);
    DownbeatScore quadruple = scoreDownbeatAlignment(chordSeries, 4);
    int bestMeter = triple.score > quadruple.score ? 3 : 4;
    DownbeatScore meterScore = bestMeter == 3 ? triple : quadruple;
    result.timeSignature = bestMeter == 3 ? "3/4" : "4/4";
    List<Map<String, Double>> beatCandidateScores = buildBeatCandidateScores(
      segments,
      beatTimes,
      bestMeter,
      meterScore.bestShift,
      keyRoot,
      mode
    );
    List<String> refinedChordSeries = refineChordSeries(
      chordSeries,
      beatCandidateScores,
      bestMeter,
      meterScore.bestShift,
      keyRoot,
      mode
    );
    refinedChordSeries = suppressIsolatedBeatFlutters(refinedChordSeries, beatCandidateScores);
    result.segments = buildBeatAlignedSegments(refinedChordSeries, beatTimes);
    return result;
  }

  private List<Long> buildBeatTimes(BeatAnalysis beatAnalysis, long analyzedDurationMs, long fallbackEndMs) {
    List<Long> beatTimes = new ArrayList<>();
    long beatIntervalMs = Math.max(1L, beatAnalysis.beatIntervalMs);
    long startMs = Math.max(0L, beatAnalysis.firstBeatOffsetMs);
    long endMs = Math.max(Math.max(analyzedDurationMs, fallbackEndMs), startMs + beatIntervalMs);

    for (long timeMs = startMs; timeMs <= endMs + beatIntervalMs; timeMs += beatIntervalMs) {
      beatTimes.add(timeMs);
    }
    if (beatTimes.isEmpty() || beatTimes.get(0) > 0L) {
      beatTimes.add(0, 0L);
    }
    return beatTimes;
  }

  private List<String> synchronizeChordSeriesToBeats(List<ChordSegment> segments, List<Long> beatTimes) {
    List<String> chordSeries = new ArrayList<>();
    if (segments.isEmpty() || beatTimes.isEmpty()) return chordSeries;

    String[] beatLabels = new String[Math.max(0, beatTimes.size() - 1)];
    for (int i = 0; i < beatLabels.length; i++) beatLabels[i] = "N";

    for (int beatIndex = 0; beatIndex < beatLabels.length; beatIndex++) {
      long beatStartMs = beatTimes.get(beatIndex);
      long beatEndMs = beatTimes.get(beatIndex + 1);
      long beatCenterMs = (beatStartMs + beatEndMs) / 2L;
      ChordSegment bestSegment = null;
      long bestOverlapMs = 0L;
      long bestCenterDistanceMs = Long.MAX_VALUE;
      for (ChordSegment segment : segments) {
        long overlapStart = Math.max(beatStartMs, segment.startMs);
        long overlapEnd = Math.min(beatEndMs, segment.endMs);
        long overlapMs = overlapEnd - overlapStart;
        long segmentCenterMs = (segment.startMs + segment.endMs) / 2L;
        long centerDistanceMs = Math.abs(segmentCenterMs - beatCenterMs);
        if (overlapMs > bestOverlapMs || (overlapMs == bestOverlapMs && centerDistanceMs < bestCenterDistanceMs)) {
          bestOverlapMs = overlapMs;
          bestSegment = segment;
          bestCenterDistanceMs = centerDistanceMs;
        }
      }
      if (bestSegment == null || bestOverlapMs <= 0L) {
        bestCenterDistanceMs = Long.MAX_VALUE;
        for (ChordSegment segment : segments) {
          long segmentCenterMs = (segment.startMs + segment.endMs) / 2L;
          long centerDistanceMs = Math.abs(segmentCenterMs - beatCenterMs);
          if (centerDistanceMs < bestCenterDistanceMs) {
            bestCenterDistanceMs = centerDistanceMs;
            bestSegment = segment;
          }
        }
      }
      if (bestSegment != null) beatLabels[beatIndex] = bestSegment.label;
    }

    String lastLabel = "N";
    for (String beatLabel : beatLabels) {
      String normalized = beatLabel == null || beatLabel.isEmpty() ? lastLabel : beatLabel;
      chordSeries.add(normalized);
      if (!"N".equals(normalized)) lastLabel = normalized;
    }
    return chordSeries;
  }

  private List<Map<String, Double>> buildBeatCandidateScores(
    List<ChordSegment> segments,
    List<Long> beatTimes,
    int timeSignature,
    int beatShift,
    int keyRoot,
    String mode
  ) {
    List<Map<String, Double>> beatCandidateScores = new ArrayList<>();
    for (int beatIndex = 0; beatIndex < beatTimes.size() - 1; beatIndex++) {
      long beatStartMs = beatTimes.get(beatIndex);
      long beatEndMs = beatTimes.get(beatIndex + 1);
      long beatCenterMs = (beatStartMs + beatEndMs) / 2L;
      long beatDurationMs = Math.max(1L, beatEndMs - beatStartMs);
      int posInBar = ((beatIndex - beatShift) % timeSignature + timeSignature) % timeSignature;
      boolean isDownbeat = posInBar == 0;
      boolean isStrongBeat = isDownbeat || (timeSignature == 4 && posInBar == 2);
      Map<String, Double> scoreMap = new HashMap<>();

      for (ChordSegment segment : segments) {
        long overlapStart = Math.max(beatStartMs, segment.startMs);
        long overlapEnd = Math.min(beatEndMs, segment.endMs);
        long overlapMs = Math.max(0L, overlapEnd - overlapStart);
        long segmentCenterMs = (segment.startMs + segment.endMs) / 2L;
        long centerDistanceMs = Math.abs(segmentCenterMs - beatCenterMs);
        if (overlapMs <= 0L && centerDistanceMs > beatDurationMs * 2L) continue;

        double proximityScore = overlapMs > 0L
          ? (overlapMs / (double) beatDurationMs) * 1.18
          : Math.max(0.0, 0.42 - ((double) centerDistanceMs / Math.max(1.0, beatDurationMs)) * 0.17);
        if (proximityScore <= 0.0) continue;

        double score = proximityScore
          + Math.max(0.0, Math.min(1.0, segment.confidence)) * 0.55
          + computeBeatPlacementBonus(segment.label, keyRoot, mode, isDownbeat, isStrongBeat);

        Double existing = scoreMap.get(segment.label);
        if (existing == null || score > existing) scoreMap.put(segment.label, score);
      }

      beatCandidateScores.add(scoreMap);
    }
    return beatCandidateScores;
  }

  private double computeBeatPlacementBonus(String label, int keyRoot, String mode, boolean isDownbeat, boolean isStrongBeat) {
    ChordCandidate candidate = decodeChordLabel(label);
    if (candidate == null) return 0;
    double structuralScore = computeDiatonicBonus(candidate.root, candidate.suffix, keyRoot, mode);
    int majorSystemRoot = "minor".equals(mode) ? (keyRoot + 3) % 12 : keyRoot;
    int degree = (candidate.root - majorSystemRoot + 12) % 12;
    double bonus = structuralScore * (isDownbeat ? 0.52 : isStrongBeat ? 0.28 : 0.14);
    if (isDownbeat) {
      if (degree == 0 || degree == 7) bonus += 0.08;
      else if (degree == 9) bonus += 0.05;
      else if (degree == 1 || degree == 3 || degree == 6 || degree == 8 || degree == 10) bonus -= 0.04;
    } else if (isStrongBeat) {
      if (degree == 5 || degree == 2) bonus += 0.04;
    }
    return bonus;
  }

  private ChordCandidate decodeChordLabel(String label) {
    if (label == null || label.isEmpty()) return null;
    String trimmed = label.trim();
    int matchedRoot = -1;
    String matchedNote = null;
    for (String note : NOTE_LABELS) {
      if (!trimmed.startsWith(note)) continue;
      if (matchedNote == null || note.length() > matchedNote.length()) {
        matchedNote = note;
      }
    }
    if (matchedNote == null) return null;
    for (int index = 0; index < NOTE_LABELS.length; index++) {
      if (NOTE_LABELS[index].equals(matchedNote)) {
        matchedRoot = index;
        break;
      }
    }
    if (matchedRoot < 0) return null;
    ChordCandidate candidate = new ChordCandidate();
    candidate.root = matchedRoot;
    candidate.suffix = trimmed.substring(matchedNote.length());
    candidate.label = trimmed;
    return candidate;
  }

  private double computeTransitionBonusByLabel(String previousLabel, String currentLabel, int keyRoot, String mode) {
    if (previousLabel == null || currentLabel == null) return 0;
    if (previousLabel.equals(currentLabel)) return 0.04;
    ChordCandidate previous = decodeChordLabel(previousLabel);
    ChordCandidate current = decodeChordLabel(currentLabel);
    if (previous == null || current == null) return previousLabel.equals(currentLabel) ? 0.04 : -0.03;
    return computeTransitionBonus(previous, current, keyRoot, mode);
  }

  private double getBeatCandidateBaseScore(Map<String, Double> scoreMap, String label) {
    if (scoreMap == null) return Double.NEGATIVE_INFINITY;
    Double score = scoreMap.get(label);
    return score == null ? Double.NEGATIVE_INFINITY : score;
  }

  private List<List<String>> buildBeatCandidateRows(List<String> chordSeries, List<Map<String, Double>> beatCandidateScores) {
    List<List<String>> rows = new ArrayList<>();
    int beatCount = Math.min(chordSeries.size(), beatCandidateScores.size());
    for (int beatIndex = 0; beatIndex < beatCount; beatIndex++) {
      List<String> labels = new ArrayList<>();
      String rawLabel = chordSeries.get(beatIndex);
      if (isValidChordLabel(rawLabel)) labels.add(rawLabel);

      Map<String, Double> scoreMap = beatCandidateScores.get(beatIndex);
      List<Map.Entry<String, Double>> entries = new ArrayList<>(scoreMap.entrySet());
      entries.sort((left, right) -> Double.compare(right.getValue(), left.getValue()));
      for (Map.Entry<String, Double> entry : entries) {
        String label = entry.getKey();
        if (!isValidChordLabel(label) || labels.contains(label)) continue;
        labels.add(label);
        if (labels.size() >= 5) break;
      }

      if (labels.isEmpty()) labels.add(isValidChordLabel(rawLabel) ? rawLabel : "N");
      rows.add(labels);
    }
    return rows;
  }

  private List<String> refineChordSeries(
    List<String> chordSeries,
    List<Map<String, Double>> beatCandidateScores,
    int timeSignature,
    int beatShift,
    int keyRoot,
    String mode
  ) {
    if (chordSeries.isEmpty() || beatCandidateScores.isEmpty()) return chordSeries;
    List<List<String>> candidateRows = buildBeatCandidateRows(chordSeries, beatCandidateScores);
    int beatCount = candidateRows.size();
    double[][] dp = new double[beatCount][];
    int[][] prevIndex = new int[beatCount][];

    for (int beatIndex = 0; beatIndex < beatCount; beatIndex++) {
      List<String> row = candidateRows.get(beatIndex);
      dp[beatIndex] = new double[row.size()];
      prevIndex[beatIndex] = new int[row.size()];
      Arrays.fill(dp[beatIndex], Double.NEGATIVE_INFINITY);
      Arrays.fill(prevIndex[beatIndex], -1);
    }

    for (int candidateIndex = 0; candidateIndex < candidateRows.get(0).size(); candidateIndex++) {
      String label = candidateRows.get(0).get(candidateIndex);
      double baseScore = getBeatCandidateBaseScore(beatCandidateScores.get(0), label);
      if (!Double.isFinite(baseScore)) baseScore = label.equals(chordSeries.get(0)) ? 0.22 : Double.NEGATIVE_INFINITY;
      if (!Double.isFinite(baseScore)) continue;
      dp[0][candidateIndex] = baseScore + (label.equals(chordSeries.get(0)) ? 0.08 : 0.0);
    }

    for (int beatIndex = 1; beatIndex < beatCount; beatIndex++) {
      int posInBar = ((beatIndex - beatShift) % timeSignature + timeSignature) % timeSignature;
      boolean isDownbeat = posInBar == 0;
      boolean isStrongBeat = isDownbeat || (timeSignature == 4 && posInBar == 2);
      List<String> currentRow = candidateRows.get(beatIndex);
      for (int currentIndex = 0; currentIndex < currentRow.size(); currentIndex++) {
        String currentLabel = currentRow.get(currentIndex);
        double baseScore = getBeatCandidateBaseScore(beatCandidateScores.get(beatIndex), currentLabel);
        if (!Double.isFinite(baseScore)) baseScore = currentLabel.equals(chordSeries.get(beatIndex)) ? 0.18 : Double.NEGATIVE_INFINITY;
        if (!Double.isFinite(baseScore)) continue;
        if (currentLabel.equals(chordSeries.get(beatIndex))) baseScore += 0.06;
        if (isDownbeat) baseScore += 0.03;
        else if (isStrongBeat) baseScore += 0.01;

        double bestScore = Double.NEGATIVE_INFINITY;
        int bestPrevIndex = -1;
        List<String> previousRow = candidateRows.get(beatIndex - 1);
        for (int previousIndex = 0; previousIndex < previousRow.size(); previousIndex++) {
          if (!Double.isFinite(dp[beatIndex - 1][previousIndex])) continue;
          String previousLabel = previousRow.get(previousIndex);
          double transitionScore = computeTransitionBonusByLabel(previousLabel, currentLabel, keyRoot, mode);
          double pathScore = dp[beatIndex - 1][previousIndex] + baseScore + transitionScore;
          if (pathScore > bestScore) {
            bestScore = pathScore;
            bestPrevIndex = previousIndex;
          }
        }
        dp[beatIndex][currentIndex] = bestScore;
        prevIndex[beatIndex][currentIndex] = bestPrevIndex;
      }
    }

    int bestLastIndex = 0;
    for (int candidateIndex = 1; candidateIndex < dp[beatCount - 1].length; candidateIndex++) {
      if (dp[beatCount - 1][candidateIndex] > dp[beatCount - 1][bestLastIndex]) bestLastIndex = candidateIndex;
    }

    List<String> refined = new ArrayList<>(chordSeries);
    for (int beatIndex = beatCount - 1; beatIndex >= 0; beatIndex--) {
      List<String> row = candidateRows.get(beatIndex);
      if (bestLastIndex < 0 || bestLastIndex >= row.size()) break;
      refined.set(beatIndex, row.get(bestLastIndex));
      bestLastIndex = prevIndex[beatIndex][bestLastIndex];
      if (beatIndex > 0 && bestLastIndex < 0) break;
    }
    return refined;
  }

  private List<String> suppressIsolatedBeatFlutters(List<String> chordSeries, List<Map<String, Double>> beatCandidateScores) {
    if (chordSeries.size() < 3) return chordSeries;
    List<String> normalized = new ArrayList<>(chordSeries);
    for (int i = 1; i < normalized.size() - 1; i++) {
      String previous = normalized.get(i - 1);
      String current = normalized.get(i);
      String next = normalized.get(i + 1);
      if (!previous.equals(next) || current.equals(previous)) continue;
      double currentScore = getBeatCandidateBaseScore(beatCandidateScores.get(i), current);
      double neighborScore = getBeatCandidateBaseScore(beatCandidateScores.get(i), previous);
      if (!Double.isFinite(neighborScore)) continue;
      if (!Double.isFinite(currentScore) || neighborScore + 0.12 >= currentScore) {
        normalized.set(i, previous);
      }
    }
    return normalized;
  }

  private int chooseBestMeter(List<String> chordSeries) {
    DownbeatScore triple = scoreDownbeatAlignment(chordSeries, 3);
    DownbeatScore quadruple = scoreDownbeatAlignment(chordSeries, 4);
    return triple.score > quadruple.score ? 3 : 4;
  }

  private DownbeatScore scoreDownbeatAlignment(List<String> chordSeries, int timeSignature) {
    DownbeatScore result = new DownbeatScore();
    result.bestShift = 0;
    result.score = 0;
    if (chordSeries == null || chordSeries.size() < 2) return result;

    boolean[] changeAt = new boolean[chordSeries.size()];
    for (int i = 1; i < chordSeries.size(); i++) {
      String previous = chordSeries.get(i - 1);
      String current = chordSeries.get(i);
      if (isValidChordLabel(previous) && isValidChordLabel(current) && !previous.equals(current)) {
        changeAt[i] = true;
      }
    }

    double bestScore = Double.NEGATIVE_INFINITY;
    int bestShift = 0;
    for (int shift = 0; shift < timeSignature; shift++) {
      int onDown = 0;
      int offDown = 0;
      for (int i = 1; i < chordSeries.size(); i++) {
        if (!changeAt[i]) continue;
        boolean isDownbeat = ((i - shift) % timeSignature + timeSignature) % timeSignature == 0;
        if (isDownbeat) onDown += 1;
        else offDown += 1;
      }
      double score = onDown * 2.0 - offDown;
      if (timeSignature == 4) {
        int onHalf = 0;
        int offHalf = 0;
        for (int i = 1; i < chordSeries.size(); i++) {
          if (!changeAt[i]) continue;
          int posInBar = ((i - shift) % 4 + 4) % 4;
          boolean isStrongBeat = posInBar % 2 == 0;
          if (isStrongBeat) onHalf += 1;
          else offHalf += 1;
        }
        double halfScore = (onHalf * 2.0 - offHalf) * 0.5;
        if (halfScore > score) score = halfScore;
      }
      if (score > bestScore) {
        bestScore = score;
        bestShift = shift;
      }
    }

    result.bestShift = bestShift;
    result.score = bestScore == Double.NEGATIVE_INFINITY ? 0 : bestScore;
    return result;
  }

  private boolean isValidChordLabel(String value) {
    return value != null && !value.isEmpty() && !"N".equals(value) && !"N/C".equals(value) && !"N.C.".equals(value);
  }

  private List<ChordSegment> buildBeatAlignedSegments(List<String> chordSeries, List<Long> beatTimes) {
    List<ChordSegment> aligned = new ArrayList<>();
    if (chordSeries.isEmpty() || beatTimes.size() < 2) return aligned;

    String currentLabel = chordSeries.get(0);
    int startBeatIndex = 0;
    for (int i = 1; i < chordSeries.size(); i++) {
      if (chordSeries.get(i).equals(currentLabel)) continue;
      if (isValidChordLabel(currentLabel)) {
        ChordSegment segment = new ChordSegment();
        segment.startMs = beatTimes.get(Math.min(startBeatIndex, beatTimes.size() - 1));
        segment.endMs = beatTimes.get(Math.min(i, beatTimes.size() - 1));
        segment.label = currentLabel;
        segment.confidence = 0.82;
        if (segment.endMs > segment.startMs) aligned.add(segment);
      }
      currentLabel = chordSeries.get(i);
      startBeatIndex = i;
    }
    if (isValidChordLabel(currentLabel)) {
      ChordSegment segment = new ChordSegment();
      segment.startMs = beatTimes.get(Math.min(startBeatIndex, beatTimes.size() - 1));
      segment.endMs = beatTimes.get(beatTimes.size() - 1);
      segment.label = currentLabel;
      segment.confidence = 0.82;
      if (segment.endMs > segment.startMs) aligned.add(segment);
    }
    return mergeAdjacentChordSegments(aligned);
  }

  private List<ChordSegment> mergeAdjacentChordSegments(List<ChordSegment> segments) {
    List<ChordSegment> merged = new ArrayList<>();
    if (segments.isEmpty()) return merged;
    ChordSegment current = segments.get(0);
    for (int i = 1; i < segments.size(); i++) {
      ChordSegment next = segments.get(i);
      if (current.label.equals(next.label) && next.startMs - current.endMs <= 240L) {
        current.endMs = next.endMs;
        current.confidence = Math.max(current.confidence, next.confidence);
        continue;
      }
      merged.add(current);
      current = next;
    }
    merged.add(current);
    return merged;
  }

  private List<ChordSegment> absorbBridgeSegments(List<ChordSegment> segments, long beatIntervalMs) {
    if (segments.size() < 3) return segments;
    List<ChordSegment> normalized = new ArrayList<>(segments);
    for (int i = 1; i < normalized.size() - 1; i++) {
      ChordSegment prev = normalized.get(i - 1);
      ChordSegment current = normalized.get(i);
      ChordSegment next = normalized.get(i + 1);
      long durationMs = current.endMs - current.startMs;
      if (durationMs > Math.min(MAX_BRIDGE_SEGMENT_MS, Math.round(beatIntervalMs * 1.15))) continue;
      if (!prev.label.equals(next.label)) continue;
      prev.endMs = next.endMs;
      prev.confidence = Math.max(prev.confidence, Math.max(current.confidence, next.confidence));
      normalized.remove(i + 1);
      normalized.remove(i);
      i -= 1;
    }
    return normalized;
  }

  private List<ChordSegment> absorbWeakShortSegments(List<ChordSegment> segments, long beatIntervalMs) {
    if (segments.size() < 2) return segments;
    List<ChordSegment> normalized = new ArrayList<>();
    for (int i = 0; i < segments.size(); i++) {
      ChordSegment current = segments.get(i);
      long durationMs = current.endMs - current.startMs;
      if (durationMs >= Math.max(MIN_CHORD_EVENT_MS, Math.round(beatIntervalMs * 0.82))) {
        normalized.add(current);
        continue;
      }
      ChordSegment prev = normalized.isEmpty() ? null : normalized.get(normalized.size() - 1);
      ChordSegment next = i + 1 < segments.size() ? segments.get(i + 1) : null;
      if (prev == null && next == null) {
        normalized.add(current);
        continue;
      }
      ChordSegment absorbTarget = null;
      if (prev != null && next != null) {
        absorbTarget = prev.confidence >= next.confidence ? prev : next;
      } else {
        absorbTarget = prev != null ? prev : next;
      }
      if (absorbTarget == next && next != null) {
        next.startMs = current.startMs;
        next.confidence = Math.max(next.confidence, current.confidence * 0.96);
      } else if (absorbTarget == prev && prev != null) {
        prev.endMs = current.endMs;
        prev.confidence = Math.max(prev.confidence, current.confidence * 0.96);
      } else {
        normalized.add(current);
      }
    }
    return normalized;
  }

  private String pickDominantNote(double[] pitchNoteEnergy, int minMidi, int maxMidi) {
    int bestMidi = -1;
    double bestEnergy = 0;
    for (int midi = Math.max(0, minMidi); midi <= Math.min(maxMidi, pitchNoteEnergy.length - 1); midi++) {
      if (pitchNoteEnergy[midi] > bestEnergy) {
        bestEnergy = pitchNoteEnergy[midi];
        bestMidi = midi;
      }
    }
    if (bestMidi < 0 || bestEnergy <= 1e-6) return null;
    return toNoteName(bestMidi);
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
    String timeSignature;
  }

  private static class AudioProfileAnalysis extends BeatAnalysis {
    String majorKey;
    double keyConfidence;
    String keyMode;
    String keyTonic;
    String highestNote;
    double highestMidi = Double.NaN;
    double highestFreqHz = Double.NaN;
    double highestTimeMs = Double.NaN;
    String dominantHighNote;
    String dominantLowNote;
    String averageNote;
    double averageMidi = Double.NaN;
    String commonHighNote;
    double commonHighMidi = Double.NaN;
    String commonLowNote;
    double commonLowMidi = Double.NaN;
    String lowestNote;
    double lowestMidi = Double.NaN;
    double lowestFreqHz = Double.NaN;
    double lowestTimeMs = Double.NaN;
    double[] waveformSamples;
    List<PitchFrameData> pitchTrack;
    List<ChordSegment> chordSegments;
  }

  private static class ChordSegment {
    long startMs;
    long endMs;
    String label;
    double confidence;
  }

  private static class SegmentPitchClassData {
    long startMs;
    long endMs;
    double[] pitchClassEnergy;
  }

  private static class PitchFrameData {
    long timeMs;
    double midi;
    double frequencyHz;
    double weight;
  }

  private static class ChordCandidate {
    int root;
    String suffix;
    String label;
    double baseScore;
    double pathScore;
    ChordCandidate prev;
  }

  private static class DownbeatScore {
    double score;
    int bestShift;
  }

  private static class BeatAlignedChordResult {
    String timeSignature;
    List<ChordSegment> segments;
  }

  private String toNoteName(int midi) {
    String[] notes = new String[] {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};
    int noteIndex = ((midi % 12) + 12) % 12;
    int octave = (midi / 12) - 1;
    return notes[noteIndex] + octave;
  }
}
