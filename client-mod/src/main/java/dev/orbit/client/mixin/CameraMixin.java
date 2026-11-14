package dev.orbit.client.mixin;

import com.llamalad7.mixinextras.injector.ModifyExpressionValue;
import com.llamalad7.mixinextras.injector.ModifyReturnValue;
import dev.orbit.client.State;
import net.minecraft.client.Camera;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;

/** Zoom (FOV divisor) and Freelook (camera uses its own yaw/pitch while the player keeps walking straight). */
@Mixin(Camera.class)
public abstract class CameraMixin {
	@ModifyReturnValue(method = "calculateFov", at = @At("RETURN"))
	private float orbit$zoom(float fov) {
		float d = State.zoomDivisor();
		return d > 1.001f ? fov / d : fov;
	}

	@ModifyExpressionValue(method = "alignWithEntity", at = @At(value = "INVOKE", target = "Lnet/minecraft/world/entity/Entity;getViewYRot(F)F"))
	private float orbit$freeYaw(float yaw) { return State.freelook ? State.lookYaw : yaw; }

	@ModifyExpressionValue(method = "alignWithEntity", at = @At(value = "INVOKE", target = "Lnet/minecraft/world/entity/Entity;getViewXRot(F)F"))
	private float orbit$freePitch(float pitch) { return State.freelook ? State.lookPitch : pitch; }
}
