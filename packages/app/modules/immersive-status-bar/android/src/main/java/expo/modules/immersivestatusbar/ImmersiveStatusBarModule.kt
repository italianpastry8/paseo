package expo.modules.immersivestatusbar

import android.view.WindowManager
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ImmersiveStatusBarModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ImmersiveStatusBar")

    Function("setEnabled") { enabled: Boolean ->
      val activity = appContext.activityProvider?.currentActivity ?: return@Function
      activity.runOnUiThread {
        val window = activity.window
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        if (enabled) {
          // DEFAULT cutout mode only lets the window extend into the cutout when it is
          // fully contained in a system bar. After rotating 90° the cutout sits on a
          // short edge, so the system letterboxes the window and hiding the status bar
          // leaves a dead band. SHORT_EDGES keeps the window full-bleed in any rotation.
          window.attributes =
            window.attributes.apply {
              layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
          controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
          controller.hide(WindowInsetsCompat.Type.statusBars())
        } else {
          window.attributes =
            window.attributes.apply {
              layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT
            }
          controller.show(WindowInsetsCompat.Type.statusBars())
        }
      }
    }

    // Synchronous read of the current display-cutout insets in dp as
    // [top, left, bottom, right]. With SHORT_EDGES the cutout insets are always
    // dispatched — even when the status bar is hidden — so the JS layer subtracts
    // them from the safe-area insets to stop the app padding a phantom cutout band.
    // react-native-safe-area-context reports dp (SerializationUtils converts via
    // PixelUtil.toDIPFromPixel), so convert px -> dp with the same density factor to
    // keep the subtraction valid. Returns zeros when the activity or its attached
    // root-window insets are unavailable. Read is best-effort: a sync module function
    // cannot hop to the UI thread, and getRootWindowInsets does not check the thread.
    Function("getDisplayCutoutInsets") {
      val activity = appContext.activityProvider?.currentActivity
      if (activity == null) {
        return@Function listOf(0.0, 0.0, 0.0, 0.0)
      }
      val insets = ViewCompat.getRootWindowInsets(activity.window.decorView)
      if (insets == null) {
        return@Function listOf(0.0, 0.0, 0.0, 0.0)
      }
      val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
      val density = activity.resources.displayMetrics.density
      listOf(
        cutout.top / density,
        cutout.left / density,
        cutout.bottom / density,
        cutout.right / density,
      ).map { it.toDouble() }
    }
  }
}
