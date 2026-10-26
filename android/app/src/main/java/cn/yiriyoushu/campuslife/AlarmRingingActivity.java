package cn.yiriyoushu.campuslife;
import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.os.*;
import android.view.*;
import android.widget.*;
import org.json.*;

public final class AlarmRingingActivity extends Activity {
    private final Handler handler=new Handler(Looper.getMainLooper());
    private TextView time,label;private Button snooze;private long opened;
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);opened=SystemClock.uptimeMillis();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED|WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON|WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if(Build.VERSION.SDK_INT>=27){setShowWhenLocked(true);setTurnScreenOn(true);}
        float density=getResources().getDisplayMetrics().density;
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setGravity(Gravity.CENTER);layout.setPadding((int)(24*density),(int)(56*density),(int)(24*density),(int)(32*density));layout.setBackgroundColor(Color.WHITE);
        TextView title=new TextView(this);title.setText("双衡 · 闹钟");title.setTextSize(18);title.setTextColor(Color.BLACK);layout.addView(title);
        time=new TextView(this);time.setTextSize(62);time.setTextColor(Color.BLACK);layout.addView(time);
        label=new TextView(this);label.setTextSize(22);label.setGravity(Gravity.CENTER);label.setMaxLines(4);label.setTextColor(Color.BLACK);layout.addView(label);
        snooze=new Button(this);snooze.setAllCaps(false);layout.addView(snooze,new LinearLayout.LayoutParams(-1,(int)(64*density)));snooze.setOnClickListener(v->command("snooze"));
        Button stop=new Button(this);stop.setText("停止闹钟");layout.addView(stop,new LinearLayout.LayoutParams(-1,(int)(64*density)));stop.setOnClickListener(v->command("dismiss"));setContentView(layout);
        if(!ringing()){
            String events=getIntent().getStringExtra("events");if(events!=null)try{startForegroundService(new Intent(this,AlarmRingingService.class).setAction("ring").putExtra("events",events));}catch(Exception ignored){}
        }
        handler.post(update);
    }
    private boolean ringing(){try{return new JSONObject(AlarmRingingService.snapshot).optBoolean("ringing");}catch(Exception e){return false;}}
    private final Runnable update=new Runnable(){public void run(){
        try {
            JSONObject status=new JSONObject(AlarmRingingService.snapshot);JSONArray events=status.optJSONArray("events");
            time.setText(java.time.LocalTime.now().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm")));
            if(events!=null&&events.length()>0){StringBuilder labels=new StringBuilder();int minutes=-1;boolean mixed=false,has=false;
                for(int i=0;i<events.length();i++){JSONObject e=events.getJSONObject(i);if(labels.length()>0)labels.append("\n");labels.append(e.optString("label").isEmpty()?"闹钟":e.optString("label"));int n=e.optInt("snoozeMinutes");if(n>0){has=true;if(minutes!=-1&&minutes!=n)mixed=true;minutes=n;}}
                label.setText(labels.toString());snooze.setVisibility(has?View.VISIBLE:View.GONE);snooze.setText(mixed?"稍后提醒":"稍后 "+minutes+" 分钟");
            }else if(SystemClock.uptimeMillis()-opened>2500){finish();return;}
        }catch(Exception ignored){}
        handler.postDelayed(this,400);
    }};
    private void command(String action){startService(new Intent(this,AlarmRingingService.class).setAction(action));finish();}
    @Override protected void onDestroy(){handler.removeCallbacksAndMessages(null);super.onDestroy();}
}
