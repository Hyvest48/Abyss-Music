package com.abyssmusic.player

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : TauriActivity() {
  companion object {
    init {
      System.loadLibrary("abyss_music_lib")
    }

    @JvmStatic
    external fun initNdkContext(activity: Activity, filesDir: String)

    @JvmStatic
    external fun onYandexToken(token: String)

    @JvmStatic
    external fun onMediaAction(action: String)

    fun dispatchMediaAction(action: String) {
      try {
        onMediaAction(action)
      } catch (_: Throwable) {}
    }

    private const val YANDEX_AUTH_URL =
      "https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d"
  }

  private var authDialog: Dialog? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    val prevHandler = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
      Log.e("AbyssMusic", "Uncaught JVM crash: ${Log.getStackTraceString(throwable)}")
      prevHandler?.uncaughtException(thread, throwable)
    }

    val dir = (applicationContext ?: this).filesDir.absolutePath
    initNdkContext(this, dir)
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    WindowCompat.getInsetsController(window, window.decorView)?.apply {
      isAppearanceLightStatusBars = false
      isAppearanceLightNavigationBars = false
    }

    val contentView = findViewById<View>(android.R.id.content)
    contentView?.setBackgroundColor(Color.parseColor("#09090B"))
    if (contentView != null) {
      ViewCompat.setOnApplyWindowInsetsListener(contentView) { v, insets ->
        val bars = insets.getInsets(
          WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime()
        )
        v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
        WindowInsetsCompat.CONSUMED
      }
      ViewCompat.requestApplyInsets(contentView)
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
      }
    }
  }

  fun updateMediaMetadata(
    title: String,
    artist: String,
    album: String,
    coverUrl: String,
    durationSec: Long
  ) {
    AbyssMediaState.title = title.ifBlank { "Abyss Music" }
    AbyssMediaState.artist = artist.ifBlank { "Исполнитель" }
    AbyssMediaState.album = album.ifBlank { "Abyss Music" }
    AbyssMediaState.coverUrl = coverUrl
    AbyssMediaState.durationSec = durationSec
    AbyssMediaService.sync(this)
  }

  fun updateMediaPlayback(isPlaying: Boolean, positionSec: Long) {
    AbyssMediaState.isPlaying = isPlaying
    AbyssMediaState.positionSec = positionSec
    AbyssMediaService.sync(this)
  }

  override fun onDestroy() {
    authDialog?.dismiss()
    authDialog = null
    super.onDestroy()
  }

  private fun dp(value: Int): Int =
    TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      value.toFloat(),
      resources.displayMetrics
    ).toInt()

  @SuppressLint("SetJavaScriptEnabled")
  fun openYandexAuthDialog() {
    runOnUiThread {
      if (isFinishing || isDestroyed) return@runOnUiThread
      if (authDialog?.isShowing == true) return@runOnUiThread

      val completed = AtomicBoolean(false)

      val dialog = Dialog(this, android.R.style.Theme_DeviceDefault_NoActionBar)
      dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
      dialog.window?.apply {
        setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        statusBarColor = Color.parseColor("#121521")
        navigationBarColor = Color.parseColor("#0B0D14")
      }

      val root = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(Color.parseColor("#0B0D14"))
        layoutParams = ViewGroup.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT
        )
      }

      val header = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(Color.parseColor("#121521"))
        setPadding(dp(16), dp(12), dp(8), dp(12))
      }

      val titleView = TextView(this).apply {
        text = "Вход через Яндекс ID — Abyss Music"
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        typeface = Typeface.DEFAULT_BOLD
        layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
      }

      val closeBtn = TextView(this).apply {
        text = "✕"
        setTextColor(Color.parseColor("#CBD5E1"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        gravity = Gravity.CENTER
        val size = dp(40)
        layoutParams = LinearLayout.LayoutParams(size, size)
        setOnClickListener { dialog.dismiss() }
      }

      header.addView(titleView)
      header.addView(closeBtn)

      val progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
        max = 100
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3))
      }

      val webView = WebView(this).apply {
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        setBackgroundColor(Color.parseColor("#0B0D14"))
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.javaScriptCanOpenWindowsAutomatically = true
        settings.setSupportMultipleWindows(false)
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
      }

      val cookieMgr = CookieManager.getInstance()
      cookieMgr.setAcceptCookie(true)
      cookieMgr.setAcceptThirdPartyCookies(webView, true)

      fun finishWithToken(rawToken: String) {
        val clean = rawToken.trim()
        if (clean.isEmpty()) return
        if (!completed.compareAndSet(false, true)) return
        cookieMgr.flush()
        onYandexToken(clean)
        dialog.dismiss()
      }

      fun tryExtractToken(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val match = Regex("""(?:[?#&]|^)access_token=([^&#]+)""").find(url) ?: return false
        val token = Uri.decode(match.groupValues[1])
        if (token.isNotBlank()) {
          finishWithToken(token)
          return true
        }
        return false
      }

      val hashWatcherJs = """
        (function() {
          function check() {
            try {
              var s = (window.location.hash || '') + '&' + (window.location.search || '');
              var m = s.match(/access_token=([^&]+)/);
              if (m && m[1] && window.AbyssAuthBridge) {
                window.AbyssAuthBridge.onToken(decodeURIComponent(m[1]));
                return true;
              }
            } catch (e) {}
            return false;
          }
          if (!check() && !window.__abyssTokenPoll) {
            window.addEventListener('hashchange', check);
            window.__abyssTokenPoll = setInterval(function() {
              if (check()) {
                clearInterval(window.__abyssTokenPoll);
              }
            }, 200);
          }
        })();
      """.trimIndent()

      webView.addJavascriptInterface(
        object {
          @JavascriptInterface
          fun onToken(token: String) {
            runOnUiThread { finishWithToken(token) }
          }
        },
        "AbyssAuthBridge"
      )

      webView.webChromeClient = object : WebChromeClient() {
        override fun onProgressChanged(view: WebView?, newProgress: Int) {
          progressBar.progress = newProgress
          progressBar.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
        }
      }

      webView.webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(
          view: WebView?,
          request: WebResourceRequest?
        ): Boolean {
          val uri = request?.url ?: return false
          val url = uri.toString()
          if (tryExtractToken(url)) return true

          val scheme = uri.scheme?.lowercase() ?: ""
          if (scheme == "intent") {
            try {
              val intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
              val fallback = intent.getStringExtra("browser_fallback_url")
              if (!fallback.isNullOrBlank() && !tryExtractToken(fallback)) {
                view?.loadUrl(fallback)
              }
            } catch (_: Exception) {}
            return true
          }

          // Never hand off http/https or custom schemes to external apps (e.g. Yandex Music)
          if (scheme != "http" && scheme != "https" && scheme != "about") {
            return true
          }

          return false
        }

        override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
          super.onPageStarted(view, url, favicon)
          if (!tryExtractToken(url)) {
            view?.evaluateJavascript(hashWatcherJs, null)
          }
        }

        override fun onPageFinished(view: WebView?, url: String?) {
          super.onPageFinished(view, url)
          if (!tryExtractToken(url)) {
            view?.evaluateJavascript(hashWatcherJs, null)
          }
        }
      }

      dialog.setOnKeyListener { _, keyCode, event ->
        if (keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
          if (webView.canGoBack()) {
            webView.goBack()
            true
          } else {
            dialog.dismiss()
            true
          }
        } else {
          false
        }
      }

      dialog.setOnDismissListener {
        authDialog = null
        try {
          webView.stopLoading()
          webView.destroy()
        } catch (_: Exception) {}
      }

      root.addView(header)
      root.addView(progressBar)
      root.addView(webView)
      dialog.setContentView(root)

      authDialog = dialog
      dialog.show()
      webView.loadUrl(YANDEX_AUTH_URL)
    }
  }
}
