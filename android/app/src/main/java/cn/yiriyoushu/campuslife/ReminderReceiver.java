package cn.yiriyoushu.campuslife;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class ReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent) {
        if(ReminderScheduler.ACTION.equals(intent.getAction()))ReminderScheduler.receive(context,intent);
        else {ReminderScheduler.sync(context);AlarmClockScheduler.sync(context);}
    }
}
