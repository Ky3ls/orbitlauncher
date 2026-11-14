package dev.orbit.client.mixin;

import dev.orbit.client.module.Modules;
import net.minecraft.client.Minecraft;
import net.minecraft.client.OptionInstance;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Fullbright: the gamma option reports a very high value while the module is on (the saved setting stays untouched). */
@Mixin(OptionInstance.class)
public abstract class OptionInstanceMixin {
	@Inject(method = "get", at = @At("HEAD"), cancellable = true)
	private void orbit$gamma(CallbackInfoReturnable<Object> cir) {
		var mc = Minecraft.getInstance();
		if (mc == null || mc.options == null || !Modules.on("fullbright")) return;
		if ((Object) this == mc.options.gamma()) cir.setReturnValue(15.0);
	}
}
