package com.abyssmusic.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

object AbyssMediaState {
  @Volatile var title: String = "Abyss Music"
  @Volatile var artist: String = "Готов к воспроизведению"
  @Volatile var album: String = "Abyss Music"
  @Volatile var coverUrl: String = ""
  @Volatile var durationSec: Long = 0L
  @Volatile var isPlaying: Boolean = false
  @Volatile var positionSec: Long = 0L
  @Volatile var coverBitmap: Bitmap? = null
}

class AbyssMediaService : Service() {
  companion object {
    const val CHANNEL_ID = "abyss_playback"
    const val NOTIFICATION_ID = 7401
    const val ACTION_SYNC = "com.abyssmusic.player.ACTION_SYNC"
    const val ACTION_PREV = "com.abyssmusic.player.ACTION_PREV"
    const val ACTION_TOGGLE = "com.abyssmusic.player.ACTION_TOGGLE"
    const val ACTION_NEXT = "com.abyssmusic.player.ACTION_NEXT"
    const val ACTION_STOP = "com.abyssmusic.player.ACTION_STOP"

    private val coverExecutor = Executors.newSingleThreadExecutor()
    @Volatile private var lastLoadedUrl: String = ""

    fun sync(context: Context) {
      val intent = Intent(context, AbyssMediaService::class.java).apply {
        action = ACTION_SYNC
      }
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (_: Exception) {
        try {
          context.startService(intent)
        } catch (_: Exception) {}
      }
      AbyssWidgetProvider.refreshAll(context)
    }
  }

  private var mediaSession: MediaSession? = null

  override fun onCreate() {
    super.onCreate()
    ensureChannel()

    mediaSession = MediaSession(this, "AbyssMusicSession").apply {
      setCallback(object : MediaSession.Callback() {
        override fun onPlay() {
          MainActivity.dispatchMediaAction("play")
        }

        override fun onPause() {
          MainActivity.dispatchMediaAction("pause")
        }

        override fun onSkipToNext() {
          MainActivity.dispatchMediaAction("next")
        }

        override fun onSkipToPrevious() {
          MainActivity.dispatchMediaAction("previous")
        }

        override fun onStop() {
          MainActivity.dispatchMediaAction("pause")
        }
      })
      isActive = true
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_PREV -> MainActivity.dispatchMediaAction("previous")
      ACTION_TOGGLE -> MainActivity.dispatchMediaAction("toggle")
      ACTION_NEXT -> MainActivity.dispatchMediaAction("next")
      ACTION_STOP -> {
        MainActivity.dispatchMediaAction("pause")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        return START_NOT_STICKY
      }
      else -> {
        maybeFetchCover(AbyssMediaState.coverUrl)
        updateNotificationAndSession()
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    mediaSession?.isActive = false
    mediaSession?.release()
    mediaSession = null
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val mgr = getSystemService(NotificationManager::class.java) ?: return
      val existing = mgr.getNotificationChannel(CHANNEL_ID)
      if (existing == null) {
        val channel = NotificationChannel(
          CHANNEL_ID,
          "Воспроизведение музыки",
          NotificationManager.IMPORTANCE_LOW
        ).apply {
          description = "Управление плеером на экране блокировки и в шторке"
          setShowBadge(false)
        }
        mgr.createNotificationChannel(channel)
      }
    }
  }

  private fun maybeFetchCover(url: String) {
    if (url.isBlank()) {
      lastLoadedUrl = ""
      AbyssMediaState.coverBitmap = null
      return
    }
    if (url == lastLoadedUrl && AbyssMediaState.coverBitmap != null) return
    lastLoadedUrl = url

    coverExecutor.execute {
      try {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
          connectTimeout = 4000
          readTimeout = 4000
          doInput = true
        }
        conn.connect()
        conn.inputStream.use { stream ->
          val raw = BitmapFactory.decodeStream(stream)
          if (raw != null && lastLoadedUrl == url) {
            val scaled = Bitmap.createScaledBitmap(raw, 256, 256, true)
            if (scaled != raw) raw.recycle()
            AbyssMediaState.coverBitmap = scaled
            updateNotificationAndSession()
            AbyssWidgetProvider.refreshAll(this@AbyssMediaService)
          }
        }
        conn.disconnect()
      } catch (_: Exception) {}
    }
  }

  private fun servicePendingIntent(action: String, reqCode: Int): PendingIntent {
    val intent = Intent(this, AbyssMediaService::class.java).apply { this.action = action }
    return PendingIntent.getService(
      this,
      reqCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun openAppPendingIntent(): PendingIntent {
    val intent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    return PendingIntent.getActivity(
      this,
      10,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun updateNotificationAndSession() {
    val session = mediaSession ?: return
    val isPlaying = AbyssMediaState.isPlaying
    val posMs = AbyssMediaState.positionSec * 1000L
    val durMs = AbyssMediaState.durationSec * 1000L

    val actions =
      PlaybackState.ACTION_PLAY or
        PlaybackState.ACTION_PAUSE or
        PlaybackState.ACTION_PLAY_PAUSE or
        PlaybackState.ACTION_SKIP_TO_NEXT or
        PlaybackState.ACTION_SKIP_TO_PREVIOUS or
        PlaybackState.ACTION_STOP

    val stateCode = if (isPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED
    session.setPlaybackState(
      PlaybackState.Builder()
        .setActions(actions)
        .setState(stateCode, posMs, if (isPlaying) 1.0f else 0.0f)
        .build()
    )

    val metaBuilder = MediaMetadata.Builder()
      .putString(MediaMetadata.METADATA_KEY_TITLE, AbyssMediaState.title)
      .putString(MediaMetadata.METADATA_KEY_ARTIST, AbyssMediaState.artist)
      .putString(MediaMetadata.METADATA_KEY_ALBUM, AbyssMediaState.album)
      .putLong(MediaMetadata.METADATA_KEY_DURATION, durMs)
    AbyssMediaState.coverBitmap?.let { bmp ->
      metaBuilder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, bmp)
    }
    session.setMetadata(metaBuilder.build())

    val playPauseIcon =
      if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
    val playPauseLabel = if (isPlaying) "Пауза" else "Играть"

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    builder
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(AbyssMediaState.title)
      .setContentText(AbyssMediaState.artist)
      .setContentIntent(openAppPendingIntent())
      .setOngoing(isPlaying)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .addAction(
        Notification.Action.Builder(
          android.R.drawable.ic_media_previous,
          "Назад",
          servicePendingIntent(ACTION_PREV, 1)
        ).build()
      )
      .addAction(
        Notification.Action.Builder(
          playPauseIcon,
          playPauseLabel,
          servicePendingIntent(ACTION_TOGGLE, 2)
        ).build()
      )
      .addAction(
        Notification.Action.Builder(
          android.R.drawable.ic_media_next,
          "Вперёд",
          servicePendingIntent(ACTION_NEXT, 3)
        ).build()
      )
      .setStyle(
        Notification.MediaStyle()
          .setMediaSession(session.sessionToken)
          .setShowActionsInCompactView(0, 1, 2)
      )

    AbyssMediaState.coverBitmap?.let { builder.setLargeIcon(it) }

    val notification = builder.build()
    try {
      startForeground(NOTIFICATION_ID, notification)
    } catch (_: Exception) {
      val mgr = getSystemService(NotificationManager::class.java)
      mgr?.notify(NOTIFICATION_ID, notification)
    }
  }
}
