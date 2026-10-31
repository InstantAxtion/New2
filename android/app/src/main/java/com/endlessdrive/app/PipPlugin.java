package com.endlessdrive.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Lets the game say when a music video is playing, so leaving the app shrinks it into a floating window. */
@CapacitorPlugin(name = "Pip")
public class PipPlugin extends Plugin {
    @PluginMethod
    public void setAllowed(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> ((MainActivity) getActivity()).setPipAllowed(on));
        call.resolve();
    }
}
