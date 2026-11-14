package dev.orbit.client.mixin;

import dev.orbit.client.State;
import net.minecraft.client.Minecraft;
import net.minecraft.client.MouseHandler;
import net.minecraft.client.input.MouseButtonInfo;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Counts real clicks for CPS (every press, not per tick) and lets the wheel control the zoom. */
@Mixin(MouseHandler.class)
public abstract class MouseHandlerMixin {
	@Inject(method = "onButton", at = @At("HEAD"))
	private void orbit$click(long window, MouseButtonInfo info, int action, CallbackInfo ci) {
		if (action == 1 && Minecraft.getInstance().gui.screen() == null) State.click(info.button());
	}

	@Inject(method = "onScroll", at = @At("HEAD"), cancellable = true)
	private void orbit$scroll(long window, double xOffset, double yOffset, CallbackInfo ci) {
		if (State.scrollZoom(yOffset)) ci.cancel();
	}
}
