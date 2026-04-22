package cn.toside.music.mobile.lyric;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.text.TextPaint;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.animation.AlphaAnimation;
import android.view.animation.AnimationSet;
import android.view.animation.TranslateAnimation;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

@SuppressLint({"ViewConstructor"})
public final class LyricSwitchView extends FrameLayout {
  private final boolean isSingleLine;
  private final TextView textView;
  private final LinearLayout multiLineLayout;
  private final List<TextView> lineViews = new ArrayList<>();
  private boolean isShowAnima;
  private int baseTextColor = Color.WHITE;
  private float textAlpha = 1f;
  private float textSizeSp = 18f;
  private int maxLines = 6;
  private int currentGravity = Gravity.START | Gravity.CENTER_VERTICAL;

  public LyricSwitchView(Context context, boolean isSingleLine, boolean isShowAnima) {
    super(context);
    this.isSingleLine = isSingleLine;
    this.isShowAnima = isShowAnima;
    if (isSingleLine) {
      textView = new LyricTextView(context);
      multiLineLayout = null;
      initLineTextView(textView, true, false);
      addView(textView, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      ));
    } else {
      textView = new TextView(context);
      multiLineLayout = new LinearLayout(context);
      multiLineLayout.setOrientation(LinearLayout.VERTICAL);
      multiLineLayout.setGravity(Gravity.CENTER_VERTICAL);
      addView(multiLineLayout, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      ));
      ensureMultiLineViews(maxLines);
    }
  }

  private int dp(int value) {
    return Math.round(TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      value,
      getResources().getDisplayMetrics()
    ));
  }

  private void initLineTextView(TextView view, boolean singleLine, boolean secondaryLine) {
    view.setIncludeFontPadding(false);
    view.setGravity(currentGravity);
    view.setPadding(dp(14), secondaryLine ? dp(3) : dp(10), dp(14), secondaryLine ? dp(3) : dp(10));
    view.setLineSpacing(dp(4), 1.05f);
    view.setSingleLine(singleLine);
    if (singleLine) {
      view.setEllipsize(TextUtils.TruncateAt.END);
    } else {
      view.setEllipsize(null);
      view.setHorizontallyScrolling(false);
      view.setMaxLines(1);
    }
    view.setTypeface(null, secondaryLine ? Typeface.NORMAL : Typeface.BOLD);
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, secondaryLine ? Math.max(12f, textSizeSp - 1f) : textSizeSp);
  }

  private void ensureMultiLineViews(int count) {
    if (multiLineLayout == null) return;
    while (lineViews.size() < count) {
      TextView view = new TextView(getContext());
      lineViews.add(view);
      multiLineLayout.addView(view, new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      ));
    }
    while (lineViews.size() > count) {
      TextView removed = lineViews.remove(lineViews.size() - 1);
      multiLineLayout.removeView(removed);
    }
    applyTextStyle();
  }

  private List<TextView> getTargetViews() {
    if (isSingleLine) {
      List<TextView> views = new ArrayList<>(1);
      views.add(textView);
      return views;
    }
    return lineViews;
  }

  private int withAlpha(int color, float alphaRatio) {
    int nextAlpha = Math.max(0, Math.min(255, Math.round(textAlpha * alphaRatio * 255f)));
    return (color & 0x00ffffff) | (nextAlpha << 24);
  }

  private void applyTextStyle() {
    if (isSingleLine) {
      textView.setTextColor(withAlpha(baseTextColor, 1f));
      textView.setTextSize(TypedValue.COMPLEX_UNIT_SP, textSizeSp);
      textView.setGravity(currentGravity);
      return;
    }
    int activeIndex = Math.max(0, (lineViews.size() - 1) / 2);
    for (int i = 0; i < lineViews.size(); i++) {
      TextView view = lineViews.get(i);
      boolean active = i == activeIndex;
      view.setTextColor(withAlpha(baseTextColor, active ? 1f : 0.56f));
      view.setTextSize(TypedValue.COMPLEX_UNIT_SP, active ? textSizeSp : Math.max(12f, textSizeSp - 1f));
      view.setTypeface(null, active ? Typeface.BOLD : Typeface.NORMAL);
      view.setGravity(currentGravity);
    }
  }

  private void playSwitchAnimation() {
    if (!isShowAnima) return;
    AnimationSet animationSet = new AnimationSet(true);
    TranslateAnimation translateAnimation = new TranslateAnimation(0f, 0f, dp(8), 0f);
    translateAnimation.setDuration(180L);
    AlphaAnimation alphaAnimation = new AlphaAnimation(0.45f, 1f);
    alphaAnimation.setDuration(180L);
    animationSet.addAnimation(translateAnimation);
    animationSet.addAnimation(alphaAnimation);
    textView.startAnimation(animationSet);
  }

  public void setShowAnima(boolean showAnima) {
    isShowAnima = showAnima;
  }

  public void setText(CharSequence text) {
    CharSequence safeText = text == null ? "" : text;
    if (isSingleLine) {
      if (TextUtils.equals(textView.getText(), safeText)) return;
      textView.setText(safeText);
      playSwitchAnimation();
      return;
    }
    String[] lines = safeText.toString().split("\\n", -1);
    ensureMultiLineViews(Math.max(1, Math.min(maxLines, lines.length)));
    int activeIndex = Math.max(0, (lineViews.size() - 1) / 2);
    int currentLineIndex = Math.min(lines.length - 1, activeIndex);
    int startIndex = Math.max(0, currentLineIndex - activeIndex);
    for (int i = 0; i < lineViews.size(); i++) {
      int sourceIndex = startIndex + i;
      lineViews.get(i).setText(sourceIndex < lines.length ? lines[sourceIndex] : "");
    }
    applyTextStyle();
    playSwitchAnimation();
  }

  public CharSequence getText() {
    return textView.getText();
  }

  public TextPaint getPaint() {
    if (isSingleLine) return textView.getPaint();
    if (!lineViews.isEmpty()) return lineViews.get(Math.max(0, (lineViews.size() - 1) / 2)).getPaint();
    return textView.getPaint();
  }

  public void setWidth(int width) {
    ViewGroup.LayoutParams params = getLayoutParams();
    if (params != null) params.width = width;
    if (isSingleLine) textView.setWidth(width);
    else if (multiLineLayout != null) multiLineLayout.setMinimumWidth(width);
  }

  public void setTextColor(int color) {
    baseTextColor = color;
    applyTextStyle();
  }

  public void setTextAlpha(float alpha) {
    textAlpha = alpha;
    applyTextStyle();
  }

  public void setShadowColor(int color) {
    for (TextView view : getTargetViews()) {
      view.setShadowLayer(1.8f, 1.3f, 1.4f, color);
    }
  }

  public void setSourceText(CharSequence text) {
    setText(text);
  }

  public void setLetterSpacings(float letterSpacing) {
    textView.setLetterSpacing(letterSpacing);
  }

  public void setHeight(int height) {
    ViewGroup.LayoutParams params = getLayoutParams();
    if (params != null) params.height = height;
    if (isSingleLine) textView.setHeight(height);
    else if (multiLineLayout != null) multiLineLayout.setMinimumHeight(height);
  }

  public void setTypeface(Typeface typeface) {
    for (TextView view : getTargetViews()) {
      view.setTypeface(typeface);
    }
  }

  public void setSingleLine(boolean value) {
    if (isSingleLine) {
      textView.setSingleLine(value);
      if (value) {
        textView.setEllipsize(TextUtils.TruncateAt.END);
      } else {
        textView.setEllipsize(null);
        textView.setHorizontallyScrolling(false);
      }
    }
  }

  public void setMaxLines(int maxLines) {
    this.maxLines = Math.max(1, maxLines);
    if (isSingleLine) textView.setMaxLines(this.maxLines);
    else ensureMultiLineViews(this.maxLines);
  }

  public void setTextSize(float size) {
    textSizeSp = size;
    applyTextStyle();
  }

  public void setGravity(int gravity) {
    currentGravity = gravity;
    if (multiLineLayout != null) multiLineLayout.setGravity(gravity);
    applyTextStyle();
  }
}
