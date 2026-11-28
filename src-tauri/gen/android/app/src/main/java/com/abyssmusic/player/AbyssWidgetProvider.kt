package com.abyssmusic.player

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

class AbyssWidgetProvider : AppWidgetProvider() {
  companion object {
    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, AbyssWidgetProvider::class.java))
      if (ids.isEmpty()) return
      for (id in ids) {
        updateSingleWidget(context, manager, id)
      }
    }

    private fun serviceActionIntent(context: Context, action: String, reqCode: Int): PendingIntent {
      val intent = Intent(context, AbyssMediaService::class.java).apply {
        this.action = action
      }
      return PendingIntent.getService(
        context,
        reqCode,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    private fun openAppIntent(context: Context): PendingIntent {
      val intent = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }
      return PendingIntent.getActivity(
        context,
        50,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    private fun updateSingleWidget(
      context: Context,
      manager: AppWidgetManager,
      widgetId: Int
    ) {
      val views = RemoteViews(context.packageName, R.layout.abyss_widget)
      views.setTextViewText(R.id.widget_title, AbyssMediaState.title)
      views.setTextViewText(R.id.widget_artist, AbyssMediaState.artist)

      val bmp = AbyssMediaState.coverBitmap
      if (bmp != null) {
        views.setImageViewBitmap(R.id.widget_cover, bmp)
      } else {
        views.setImageViewResource(R.id.widget_cover, R.mipmap.ic_launcher)
      }

      val playIcon =
        if (AbyssMediaState.isPlaying) {
          android.R.drawable.ic_media_pause
        } else {
          android.R.drawable.ic_media_play
        }
      views.setImageViewResource(R.id.widget_play_pause, playIcon)

      views.setOnClickPendingIntent(R.id.widget_cover, openAppIntent(context))
      views.setOnClickPendingIntent(R.id.widget_info_area, openAppIntent(context))
      views.setOnClickPendingIntent(
        R.id.widget_prev,
        serviceActionIntent(context, AbyssMediaService.ACTION_PREV, 101)
      )
      views.setOnClickPendingIntent(
        R.id.widget_play_pause,
        serviceActionIntent(context, AbyssMediaService.ACTION_TOGGLE, 102)
      )
      views.setOnClickPendingIntent(
        R.id.widget_next,
        serviceActionIntent(context, AbyssMediaService.ACTION_NEXT, 103)
      )

      manager.updateAppWidget(widgetId, views)
    }
  }

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray
  ) {
    refreshAll(context)
  }
}
