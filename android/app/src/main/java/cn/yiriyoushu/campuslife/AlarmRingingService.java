package cn.yiriyoushu.campuslife;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.*;
import android.os.*;
import org.json.*;
import java.util.*;

public final class AlarmRingingService extends Service {
    static volatile String snapshot="{}";
    private static volatile AlarmRingingService instance;
    private final LinkedHashMap<String,JSONObject> active=new LinkedHashMap<>();
    private final Handler handler=new Handler(Looper.getMainLooper());
    private MediaPlayer player;private Vibrator vibrator;private PowerManager.WakeLock wake;
    private AudioFocusRequest focus;private boolean playing,prepared;private long expires;
    private int focusRetries;private String audioError="";
    static final int NOTIFICATION=4901;
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onCreate(){super.onCreate();instance=this;AlarmClockScheduler.channel(this);}
    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        String action=intent==null?"":intent.getAction();
        if("dismiss".equals(action)||"snooze".equals(action)){
            if("snooze".equals(action))AlarmClockScheduler.snooze(this,new ArrayList<>(active.values()));
            stopRing();return START_NOT_STICKY;
        }
        try {
            JSONArray list=new JSONArray(intent==null?"[]":intent.getStringExtra("events"));
            synchronized(MainActivity.LEDGER_LOCK){for(int i=0;i<list.length();i++){JSONObject e=list.getJSONObject(i);if(AlarmClockScheduler.find(this,e.optString("id"),e.optString("generation"))!=null)active.put(e.getString("key"),e);}}
            if(active.isEmpty()){stopSelf();return START_NOT_STICKY;}
            updateSnapshot();Notification notification=notification(this,new JSONArray(active.values()),true);
            if(Build.VERSION.SDK_INT>=29)startForeground(NOTIFICATION,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);else startForeground(NOTIFICATION,notification);
            if(expires==0){expires=System.currentTimeMillis()+300000;handler.postDelayed(this::stopRing,300000);}
            if(wake==null){wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Shuangheng:alarm");wake.acquire(360000);}
            if(player==null)startTone(RingtoneManager.TYPE_ALARM);
            vibrate();
        }catch(Exception e){android.util.Log.e("AlarmClock","Ringing failed",e);stopRing();}
        return START_NOT_STICKY;
    }
    private void startTone(int type) {
        if(active.isEmpty()||player!=null)return;
        try {
            AudioAttributes attrs=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
            if(focus==null){focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attrs).setOnAudioFocusChangeListener(change->{
                try{if(change==AudioManager.AUDIOFOCUS_LOSS){stopRing();}else if(change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT&&playing){player.pause();playing=false;updateSnapshot();}else if(change==AudioManager.AUDIOFOCUS_GAIN&&prepared&&player!=null){player.start();playing=true;updateSnapshot();}}catch(Exception ignored){}
            }).build();}
            int result=getSystemService(AudioManager.class).requestAudioFocus(focus);
            if(result!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED){audioError="Audio focus not granted: "+result;updateSnapshot();android.util.Log.w("AlarmClock",audioError);if(focusRetries++<20)handler.postDelayed(()->startTone(type),300);return;}
            player=new MediaPlayer();player.setAudioAttributes(attrs);player.setLooping(true);
            if(type==0){try(android.content.res.AssetFileDescriptor sound=getResources().openRawResourceFd(R.raw.alarm_fallback)){player.setDataSource(sound.getFileDescriptor(),sound.getStartOffset(),sound.getLength());}}
            else player.setDataSource(this,RingtoneManager.getDefaultUri(type));
            player.setOnPreparedListener(p->{prepared=true;p.start();playing=true;audioError="";android.util.Log.i("AlarmClock","Alarm audio playing, source="+type);updateSnapshot();});
            player.setOnErrorListener((p,what,extra)->{audioError="MediaPlayer error "+what+"/"+extra+", source="+type;android.util.Log.e("AlarmClock",audioError);releasePlayer();if(type==RingtoneManager.TYPE_ALARM)startTone(RingtoneManager.TYPE_NOTIFICATION);else if(type!=0)startTone(0);return true;});
            player.prepareAsync();
        }catch(Exception error){audioError=error.toString();android.util.Log.e("AlarmClock","Cannot load alarm audio, source="+type,error);releasePlayer();if(type==RingtoneManager.TYPE_ALARM)startTone(RingtoneManager.TYPE_NOTIFICATION);else if(type!=0)startTone(0);}
    }
    private void releasePlayer(){playing=false;prepared=false;if(player!=null){try{player.release();}catch(Exception ignored){}player=null;}updateSnapshot();}
    private void vibrate(){
        if(vibrator==null)vibrator=(Vibrator)getSystemService(VIBRATOR_SERVICE);
        boolean enabled=false;for(JSONObject e:active.values())if(e.optBoolean("vibrate",true))enabled=true;
        if(vibrator!=null){vibrator.cancel();if(enabled&&vibrator.hasVibrator())vibrator.vibrate(VibrationEffect.createWaveform(new long[]{0,500,700},0));}
    }
    private void updateSnapshot(){try{snapshot=new JSONObject().put("ringing",!active.isEmpty()).put("soundPlaying",playing).put("audioError",audioError).put("events",new JSONArray(active.values())).toString();}catch(Exception ignored){}}
    static void reconcile(){AlarmRingingService service=instance;if(service!=null)service.handler.post(()->{
        synchronized(MainActivity.LEDGER_LOCK){service.active.entrySet().removeIf(item->AlarmClockScheduler.find(service,item.getValue().optString("id"),item.getValue().optString("generation"))==null);}
        if(service.active.isEmpty()||!AlarmClockScheduler.allowed(service))service.stopRing();
        else{service.updateSnapshot();service.vibrate();service.getSystemService(NotificationManager.class).notify(NOTIFICATION,notification(service,new JSONArray(service.active.values()),true));}
    });}
    private void stopRing(){
        handler.removeCallbacksAndMessages(null);active.clear();releasePlayer();if(vibrator!=null)vibrator.cancel();
        if(focus!=null)getSystemService(AudioManager.class).abandonAudioFocusRequest(focus);
        if(wake!=null&&wake.isHeld())wake.release();wake=null;snapshot="{}";
        stopForeground(STOP_FOREGROUND_REMOVE);getSystemService(NotificationManager.class).cancel(NOTIFICATION);stopSelf();
    }
    @Override public void onDestroy(){instance=null;stopRing();super.onDestroy();}
    static PendingIntent action(Context c,String action,int code){return PendingIntent.getService(c,code,new Intent(c,AlarmRingingService.class).setAction(action),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    static Notification notification(Context c,JSONArray events,boolean ongoing) {
        StringBuilder labels=new StringBuilder();boolean snooze=false;
        for(int i=0;i<events.length();i++){JSONObject e=events.optJSONObject(i);if(e==null)continue;if(labels.length()>0)labels.append("、");labels.append(e.optString("label").isEmpty()?e.optString("time"):e.optString("label"));if(e.optInt("snoozeMinutes")>0)snooze=true;}
        PendingIntent content=PendingIntent.getActivity(c,4901,new Intent(c,AlarmRingingActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("events",events.toString()),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=new Notification.Builder(c,AlarmClockScheduler.CHANNEL).setSmallIcon(R.drawable.ic_notification).setContentTitle("闹钟响了").setContentText(labels.toString())
                .setStyle(new Notification.BigTextStyle().bigText(labels.toString())).setContentIntent(content).setCategory(Notification.CATEGORY_ALARM).setOngoing(ongoing).setOnlyAlertOnce(true)
                .addAction(new Notification.Action.Builder(null,"停止",action(c,"dismiss",4902)).build());
        if(snooze)builder.addAction(new Notification.Action.Builder(null,"稍后提醒",action(c,"snooze",4903)).build());
        if(AlarmClockScheduler.fullScreen(c))builder.setFullScreenIntent(content,true);
        if(!ongoing)builder.setTimeoutAfter(600000);
        return builder.build();
    }
    static void fallback(Context c,JSONArray events){c.getSystemService(NotificationManager.class).notify(NOTIFICATION,notification(c,events,false));}
}
