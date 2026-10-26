package cn.yiriyoushu.campuslife;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** One chained alarm avoids per-device alarm-count limits. Ledger remains the source of truth. */
final class ReminderScheduler {
    static final String CHANNEL="task-reminders-v1";
    static final String ACTION="cn.yiriyoushu.campuslife.TASK_REMINDER";
    private static final String PREFS="task-reminder-receipts";
    static final class Event {
        String key,id,date,title,phase; long fire,boundary; int lead;
        String message(long now) {
            long minutes=Math.max(0,(long)Math.ceil((boundary-now)/60000.0));
            return title+" · "+(minutes>0?minutes+" 分钟后":"现在")+(phase.equals("start")?"开始":"结束");
        }
    }
    private static JSONObject ledger(Context context) {
        try {
            AtomicFile file=new AtomicFile(new File(context.getFilesDir(),"ledger-checkpoint.json"));
            return new JSONObject(new String(file.readFully(),StandardCharsets.UTF_8));
        } catch(Exception error) {return new JSONObject();}
    }
    private static boolean enabled(JSONObject ledger) {
        JSONObject settings=ledger.optJSONObject("reminderSettings");
        return settings!=null && Boolean.TRUE.equals(settings.opt("enabled"));
    }
    private static long wallTime(LocalDate date,int minute) {
        return date.atStartOfDay().plusMinutes(minute).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }
    private static List<Event> events(JSONObject ledger) {
        List<Event> list=new ArrayList<>();
        if(!enabled(ledger))return list;
        JSONArray entries=ledger.optJSONArray("timeEntries");
        if(entries==null)return list;
        for(int i=0;i<entries.length();i++) {
            try {
                JSONObject entry=entries.getJSONObject(i),choice=entry.optJSONObject("reminders");
                if(choice==null)continue;
                String id=entry.getString("id"),title=entry.getString("title"),day=entry.getString("date");
                LocalDate date=LocalDate.parse(day);
                int start=entry.getInt("start"),end=entry.getInt("end");
                if(id.isEmpty()||id.length()>128||title.isEmpty()||title.length()>24||start<0||start>=1440||end<=start||end>start+1440)continue;
                for(String phase:new String[]{"start","end"}) {
                    Object raw=choice.opt(phase);
                    if(!(raw instanceof Number))continue;
                    int lead=((Number)raw).intValue();
                    if(lead<0||lead>1440||((Number)raw).doubleValue()!=lead)continue;
                    Event event=new Event();event.id=id;event.title=title;event.date=day;event.phase=phase;event.lead=lead;
                    event.boundary=wallTime(date,phase.equals("start")?start:end);
                    event.fire=event.boundary-lead*60000L;
                    if(phase.equals("end"))event.fire=Math.max(wallTime(date,start),event.fire);
                    event.key=id+"|"+day+"|"+start+"|"+end+"|"+phase+"|"+lead;
                    list.add(event);
                }
            } catch(Exception invalidEntry) { /* A bad reminder must not damage or replace the ledger. */ }
        }
        list.sort(Comparator.comparingLong(e->e.fire));return list;
    }
    private static JSONObject receipts(Context context) {
        try{return new JSONObject(context.getSharedPreferences(PREFS,0).getString("delivered","{}"));}
        catch(Exception error){return new JSONObject();}
    }
    static void channel(Context context) {
        NotificationChannel channel=new NotificationChannel(CHANNEL,"任务开始与结束提醒",NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("时间任务的开始前和结束前提醒");channel.enableVibration(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    static boolean notificationsAllowed(Context context) {
        channel(context);
        if(Build.VERSION.SDK_INT>=33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return false;
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        NotificationChannel channel=manager.getNotificationChannel(CHANNEL);
        return manager.areNotificationsEnabled()&&channel!=null&&channel.getImportance()!=NotificationManager.IMPORTANCE_NONE;
    }
    private static PendingIntent alarmIntent(Context context,String key,long fire) {
        Intent intent=new Intent(context,ReminderReceiver.class).setAction(ACTION).putExtra("key",key).putExtra("fire",fire);
        return PendingIntent.getBroadcast(context,704,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    static boolean exactAllowed(Context context) {
        return Build.VERSION.SDK_INT<31||context.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }
    static void sync(Context context) {
        synchronized(MainActivity.LEDGER_LOCK) {
            AlarmManager alarms=context.getSystemService(AlarmManager.class);
            android.content.SharedPreferences prefs=context.getSharedPreferences(PREFS,0);
            String previous=prefs.getString("pendingKey","");
            PendingIntent pending=alarmIntent(context,"",0);alarms.cancel(pending);
            JSONObject ledger=ledger(context),delivered=receipts(context);
            // Turning off clears notifications as well as the one pending alarm.
            if(!enabled(ledger)){NotificationManager m=context.getSystemService(NotificationManager.class);for(android.service.notification.StatusBarNotification n:m.getActiveNotifications())if(CHANNEL.equals(n.getNotification().getChannelId()))m.cancel(n.getTag(),n.getId());prefs.edit().remove("pendingKey").apply();return;}
            long now=System.currentTimeMillis();
            List<Event> planned=events(ledger);Event next=null;
            java.util.Set<String> validKeys=new java.util.HashSet<>();for(Event event:planned)validKeys.add(event.key);
            NotificationManager manager=context.getSystemService(NotificationManager.class);
            for(android.service.notification.StatusBarNotification notification:manager.getActiveNotifications())
                if(CHANNEL.equals(notification.getNotification().getChannelId())&&!validKeys.contains(notification.getTag()))manager.cancel(notification.getTag(),notification.getId());
            // Resume/time changes must not discard an alarm already becoming due.
            for(Event event:planned)if(event.key.equals(previous)&&event.fire<=now&&now<event.boundary+60000&&!delivered.has(event.key)){next=event;break;}
            if(next==null)for(Event event:planned)if(event.fire>now&&!delivered.has(event.key)){next=event;break;}
            prefs.edit().putString("pendingKey",next==null?"":next.key).apply();
            if(next!=null) {
                Event event=next;
                pending=alarmIntent(context,event.key,event.fire);
                long trigger=Math.max(event.fire,now+500);
                try {
                    if(exactAllowed(context))alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,trigger,pending);
                    else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,trigger,pending);
                } catch(SecurityException revoked) {alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,trigger,pending);}
            }
        }
    }
    static JSONObject status(Context context) {
        synchronized(MainActivity.LEDGER_LOCK) {
            JSONObject status=new JSONObject();
            try {
                status.put("notifications",notificationsAllowed(context));status.put("exact",exactAllowed(context));
                long next=0,now=System.currentTimeMillis();JSONObject delivered=receipts(context);
                for(Event event:events(ledger(context)))if(event.fire>now&&!delivered.has(event.key)){next=event.fire;break;}
                status.put("nextAt",next);
            }catch(Exception error){ /* Return the available status without changing data. */ }
            return status;
        }
    }
    static void receive(Context context,Intent intent) {
        synchronized(MainActivity.LEDGER_LOCK) {
            List<Event> events=events(ledger(context));JSONObject delivered=receipts(context);
            String key=intent.getStringExtra("key");long expected=intent.getLongExtra("fire",-1),now=System.currentTimeMillis();
            boolean valid=false;
            for(Event event:events)if(event.key.equals(key)&&event.fire==expected&&!delivered.has(event.key)){valid=true;break;}
            List<Event> due=new ArrayList<>();
            if(valid)for(Event event:events)if(event.fire>=expected&&event.fire<=now+1000&&now<event.boundary+60000&&!delivered.has(event.key))due.add(event);
            try {
                List<String> old=new ArrayList<>();delivered.keys().forEachRemaining(k->{if(delivered.optLong(k)<now-7*86400000L)old.add(k);});
                for(String k:old)delivered.remove(k);
                for(Event event:due)delivered.put(event.key,now);
                if(!context.getSharedPreferences(PREFS,0).edit().putString("delivered",delivered.toString()).commit())return;
                boolean foreground=MainActivity.presentReminders(due);
                if(notificationsAllowed(context))for(Event event:due)post(context,event,foreground);
            }catch(Exception error){android.util.Log.e("TaskReminder","Unable to deliver reminder",error);}
            finally{sync(context);}
        }
    }
    private static void post(Context context,Event event,boolean silent) {
        Intent open=new Intent(context,MainActivity.class).setData(new Uri.Builder().scheme("shuangheng").authority("task").appendPath(event.key).build())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("reminderDate",event.date).putExtra("reminderId",event.id);
        PendingIntent content=PendingIntent.getActivity(context,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=new Notification.Builder(context,CHANNEL).setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(event.phase.equals("start")?"任务即将开始":"任务即将结束")
                .setContentText(event.message(System.currentTimeMillis())).setContentIntent(content)
                .setCategory(Notification.CATEGORY_REMINDER).setAutoCancel(true).setShowWhen(true)
                .setVisibility(Notification.VISIBILITY_PRIVATE).setTimeoutAfter(Math.max(1000,event.boundary+60000-System.currentTimeMillis()));
        if(silent)builder.setGroup("foreground-reminders").setGroupAlertBehavior(Notification.GROUP_ALERT_SUMMARY);
        context.getSystemService(NotificationManager.class).notify(event.key,0,builder.build());
    }
}
