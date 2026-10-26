package cn.yiriyoushu.campuslife;

import android.app.*;
import android.content.*;
import android.os.Build;
import android.util.AtomicFile;
import org.json.*;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;

final class AlarmClockScheduler {
    static final String CHANNEL="alarm-clock-v1",ACTION="cn.yiriyoushu.campuslife.ALARM_CLOCK",PREFS="alarm-clock-runtime";
    static final long LATE=600000;
    static JSONObject ledger(Context c) {
        try{return new JSONObject(new String(new AtomicFile(new File(c.getFilesDir(),"ledger-checkpoint.json")).readFully(),StandardCharsets.UTF_8));}catch(Exception e){return new JSONObject();}
    }
    static JSONObject data(Context c,String name) {
        try{return new JSONObject(c.getSharedPreferences(PREFS,0).getString(name,"{}"));}catch(Exception e){return new JSONObject();}
    }
    static void channel(Context c) {
        NotificationChannel channel=new NotificationChannel(CHANNEL,"闹钟响铃",NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("独立闹钟的响铃界面与停止、稍后提醒操作");channel.setSound(null,null);channel.enableVibration(false);
        c.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    static boolean allowed(Context c) {
        channel(c);NotificationManager n=c.getSystemService(NotificationManager.class);
        return (Build.VERSION.SDK_INT<33||c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)==android.content.pm.PackageManager.PERMISSION_GRANTED)&&n.areNotificationsEnabled()&&n.getNotificationChannel(CHANNEL).getImportance()!=NotificationManager.IMPORTANCE_NONE;
    }
    static boolean fullScreen(Context c) {return Build.VERSION.SDK_INT<34||c.getSystemService(NotificationManager.class).canUseFullScreenIntent();}
    static JSONObject find(Context c,String id,String generation) {
        JSONArray list=ledger(c).optJSONArray("alarms");if(list==null)return null;
        for(int i=0;i<list.length();i++){JSONObject a=list.optJSONObject(i);if(a!=null&&id.equals(a.optString("id"))&&generation.equals(a.optString("generation"))&&Boolean.TRUE.equals(a.opt("enabled")))return a;}return null;
    }
    private static JSONObject event(JSONObject alarm,long at,String date,String key)throws JSONException {
        return new JSONObject().put("id",alarm.getString("id")).put("generation",alarm.getString("generation")).put("at",at).put("key",key)
                .put("label",alarm.optString("label","")).put("time",alarm.getString("time")).put("snoozeMinutes",alarm.optInt("snoozeMinutes",10)).put("vibrate",alarm.optBoolean("vibrate",true));
    }
    static List<JSONObject> events(Context c,long now) {
        List<JSONObject> events=new ArrayList<>();JSONArray list=ledger(c).optJSONArray("alarms");JSONObject snoozes=data(c,"snoozes");
        if(list==null)return events;
        for(int i=0;i<list.length();i++)try {
            JSONObject a=list.getJSONObject(i);if(!Boolean.TRUE.equals(a.opt("enabled")))continue;
            String id=a.getString("id"),gen=a.getString("generation"),time=a.getString("time");
            if(id.isEmpty()||gen.isEmpty()||id.length()>128||gen.length()>128||!time.matches("([01]\\d|2[0-3]):[0-5]\\d"))continue;
            LocalTime clock=LocalTime.parse(time);JSONArray days=a.getJSONArray("days");
            JSONObject sn=snoozes.optJSONObject(id);
            if(sn!=null&&gen.equals(sn.optString("generation"))&&sn.optLong("at")>now-LATE)events.add(event(a,sn.getLong("at"),"",sn.getString("key")));
            for(int offset=days.length()==0?0:-1;offset<=7;offset++) {
                LocalDate date=days.length()==0?LocalDate.parse(a.getString("date")):LocalDate.now().plusDays(offset);
                boolean matches=days.length()==0;for(int d=0;d<days.length();d++)if(days.optInt(d)==date.getDayOfWeek().getValue())matches=true;
                long at=date.atTime(clock).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
                if(matches&&at>now-LATE)events.add(event(a,at,date.toString(),id+"|"+gen+"|"+date));
                if(days.length()==0)break;
            }
        }catch(Exception invalid){ /* Ignore malformed clocks without changing the ledger. */ }
        events.sort(Comparator.comparingLong(e->e.optLong("at")));return events;
    }
    static PendingIntent alarmIntent(Context c,String key,long at) {
        return PendingIntent.getBroadcast(c,4900,new Intent(c,AlarmClockReceiver.class).setAction(ACTION).putExtra("key",key).putExtra("at",at),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    static void sync(Context c) {
        synchronized(MainActivity.LEDGER_LOCK) {
            AlarmManager manager=c.getSystemService(AlarmManager.class);manager.cancel(alarmIntent(c,"",0));
            AlarmRingingService.reconcile();
            if(!allowed(c)||!ReminderScheduler.exactAllowed(c))return;
            long now=System.currentTimeMillis();JSONObject receipts=data(c,"receipts");String previous=c.getSharedPreferences(PREFS,0).getString("pending","");
            List<JSONObject> list=events(c,now);JSONObject next=null;
            for(JSONObject e:list)if(e.optString("key").equals(previous)&&!receipts.has(previous)&&e.optLong("at")<=now){next=e;break;}
            if(next==null)for(JSONObject e:list)if(e.optLong("at")>now&&!receipts.has(e.optString("key"))){next=e;break;}
            c.getSharedPreferences(PREFS,0).edit().putString("pending",next==null?"":next.optString("key")).apply();
            if(next!=null)try {
                PendingIntent show=PendingIntent.getActivity(c,4900,new Intent(c,MainActivity.class).putExtra("openClock",true),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                manager.setAlarmClock(new AlarmManager.AlarmClockInfo(Math.max(now+500,next.getLong("at")),show),alarmIntent(c,next.getString("key"),next.getLong("at")));
            }catch(Exception e){android.util.Log.e("AlarmClock","Cannot schedule clock",e);}
        }
    }
    static JSONObject status(Context c) {
        synchronized(MainActivity.LEDGER_LOCK) {
            JSONObject out=new JSONObject();try {
                out.put("notifications",allowed(c)).put("exact",ReminderScheduler.exactAllowed(c)).put("fullScreen",fullScreen(c)).put("snoozes",data(c,"snoozes"));
                JSONObject live=new JSONObject(AlarmRingingService.snapshot);out.put("ringing",live.optBoolean("ringing")).put("soundPlaying",live.optBoolean("soundPlaying")).put("audioError",live.optString("audioError"));
                long now=System.currentTimeMillis(),next=0;JSONObject receipts=data(c,"receipts");for(JSONObject e:events(c,now))if(e.optLong("at")>now&&!receipts.has(e.optString("key"))){next=e.getLong("at");break;}
                out.put("nextAt",next);
            }catch(Exception ignored){}return out;
        }
    }
    static void snooze(Context c,Collection<JSONObject> active) {
        synchronized(MainActivity.LEDGER_LOCK){JSONObject data=data(c,"snoozes");try{
            for(JSONObject e:active){JSONObject alarm=find(c,e.optString("id"),e.optString("generation"));if(alarm==null)continue;int minutes=alarm.optInt("snoozeMinutes",10);if(minutes!=5&&minutes!=10&&minutes!=15)continue;
                long at=System.currentTimeMillis()+minutes*60000L;String id=alarm.getString("id"),gen=alarm.getString("generation");data.put(id,new JSONObject().put("generation",gen).put("at",at).put("key","snooze|"+id+"|"+gen+"|"+at));}
            c.getSharedPreferences(PREFS,0).edit().putString("snoozes",data.toString()).commit();
        }catch(Exception ignored){}sync(c);}
    }
    static void cancelSnooze(Context c,String id) {synchronized(MainActivity.LEDGER_LOCK){JSONObject data=data(c,"snoozes");data.remove(id);c.getSharedPreferences(PREFS,0).edit().putString("snoozes",data.toString()).commit();sync(c);}}
    static void receive(Context c,Intent intent) {
        synchronized(MainActivity.LEDGER_LOCK) {
            if(!allowed(c)||!ReminderScheduler.exactAllowed(c)){sync(c);return;}
            long now=System.currentTimeMillis(),at=intent.getLongExtra("at",-1);String key=intent.getStringExtra("key");JSONObject receipts=data(c,"receipts"),snoozes=data(c,"snoozes");List<JSONObject> list=events(c,now);boolean valid=false;
            for(JSONObject e:list)if(e.optString("key").equals(key)&&e.optLong("at")==at&&!receipts.has(key))valid=true;
            JSONArray due=new JSONArray();try{
                if(valid)for(JSONObject e:list)if(e.optLong("at")>=at&&e.optLong("at")<=now+1000&&!receipts.has(e.getString("key"))){due.put(e);receipts.put(e.getString("key"),now);snoozes.remove(e.getString("id"));}
                List<String> old=new ArrayList<>();receipts.keys().forEachRemaining(k->{if(receipts.optLong(k)<now-8*86400000L)old.add(k);});for(String k:old)receipts.remove(k);
                if(!c.getSharedPreferences(PREFS,0).edit().putString("receipts",receipts.toString()).putString("snoozes",snoozes.toString()).commit())return;
                sync(c);
                if(due.length()>0)try{c.startForegroundService(new Intent(c,AlarmRingingService.class).setAction("ring").putExtra("events",due.toString()));}
                catch(Exception error){android.util.Log.e("AlarmClock","Cannot start ringing service",error);AlarmRingingService.fallback(c,due);}
            }catch(Exception error){android.util.Log.e("AlarmClock","Cannot deliver clock",error);}
        }
    }
}
