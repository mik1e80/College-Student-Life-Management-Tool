package cn.yiriyoushu.campuslife;
import android.content.*;
public final class AlarmClockReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){if(AlarmClockScheduler.ACTION.equals(intent.getAction()))AlarmClockScheduler.receive(context,intent);}
}
