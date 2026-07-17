/**
 * @file hal_lens_af0832.h
 * @brief High-level AF0832 lens convenience API built on top of HalLensOps.
 *
 * This is platform-independent code (implemented in hal_v2/common/devices/).
 */
#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "../../common/hal_common.h"
#include "hal_lens.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Wire values match MCU ms41908m_state_t (host_link_lens_state_t fields).
 * Use for interpreting HalLensState zoom_state / focus_state / iris_state.
 */
typedef enum {
    HAL_LENS_MS41908M_STATE_NO_CFG = 0,
    HAL_LENS_MS41908M_STATE_STOPPED = 1,
    HAL_LENS_MS41908M_STATE_RUNNING = 2,
    HAL_LENS_MS41908M_STATE_RESET_ZERO = 3,
    HAL_LENS_MS41908M_STATE_ERROR = 4,
} HalLensMs41908mState;

/**
 * Event bits in MCU lens event (host_link_lens_evt_t.event).
 */
#define HAL_LENS_EVT_ZOOM_COMPLETED     (1u << 5)
#define HAL_LENS_EVT_FOCUS_COMPLETED    (1u << 4)
#define HAL_LENS_EVT_ZOOM_RESET_DONE    (1u << 8)
#define HAL_LENS_EVT_FOCUS_RESET_DONE   (1u << 9)

/**
 * Default soft limits (HAL steps).
 *
 * These defaults are chosen to be compatible with the AF0832 tracking table used by
 * hal_lens_af0832_goto_by_ratio_distance(), including some margin up to the spec
 * mechanical dead-points (table step * 4).
 *
 * Replace with calibrated values via HalLensAf0832Params for production.
 */
#define HAL_LENS_AF0832_DEFAULT_ZOOM_MIN_POS   -3236  /* reversed zoom: -(809 * 4) */
#define HAL_LENS_AF0832_DEFAULT_ZOOM_MAX_POS   760    /* reversed zoom: -(-190 * 4) */
#define HAL_LENS_AF0832_DEFAULT_FOCUS_MIN_POS  -844   /* spec FOCUS back dead-point: -211 * 4 */
#define HAL_LENS_AF0832_DEFAULT_FOCUS_MAX_POS  592    /* spec FOCUS front dead-point: 148 * 4 */

typedef struct HalLensAf0832 HalLensAf0832;

typedef void (*HalLensAf0832OnEvent)(HalLensAf0832 *dev, uint32_t event, int32_t result,
                                     int32_t zoom_pos, int32_t focus_pos, void *userdata);

typedef struct {
    uint32_t bootstrap_timeout_ms;
    uint32_t op_timeout_ms;

    HalLensLimit zoom_limit;
    HalLensLimit focus_limit;

    /**
     * Default speed (pps) used by high-level convenience helpers
     * (e.g. hal_lens_af0832_goto_by_ratio_distance()).
     */
    uint16_t default_pps;
} HalLensAf0832Params;

void hal_lens_af0832_params_init_defaults(HalLensAf0832Params *p);

int hal_lens_af0832_create(void *mcu_ctx, const HalLensAf0832Params *params, HalLensAf0832 **out_dev);
void hal_lens_af0832_destroy(HalLensAf0832 *dev);

int hal_lens_af0832_bootstrap(HalLensAf0832 *dev);

void hal_lens_af0832_mark_bootstrapped(HalLensAf0832 *dev);

int hal_lens_af0832_set_event_callback(HalLensAf0832 *dev, HalLensAf0832OnEvent cb, void *userdata);

int hal_lens_af0832_state_get(HalLensAf0832 *dev, HalLensState *state);

int hal_lens_af0832_iris_target_set(HalLensAf0832 *dev, uint16_t target);
int hal_lens_af0832_iris_adc_get(HalLensAf0832 *dev, uint16_t *adc);

int hal_lens_af0832_iris_run(HalLensAf0832 *dev, const HalLensMotion *motion);
int hal_lens_af0832_zoom_run(HalLensAf0832 *dev, const HalLensMotion *motion);
int hal_lens_af0832_zoom_abs(HalLensAf0832 *dev, const HalLensMotion *motion);
int hal_lens_af0832_focus_run(HalLensAf0832 *dev, const HalLensMotion *motion);
int hal_lens_af0832_focus_abs(HalLensAf0832 *dev, const HalLensMotion *motion);

/**
 * @brief Force reset-zero (homing) for both zoom and focus motors.
 *
 * Unlike hal_lens_af0832_bootstrap(), this API always triggers zoom_rz and focus_rz
 * even if the current state already reports *_rz_done. The call blocks until both
 * reset-zero operations complete (by event and/or rz_done polling), or until timeout.
 *
 * @param dev Lens device (bootstrapped).
 * @return HAL_OK on success, otherwise a negative HalErrorCode / HAL_ERROR.
 */
int hal_lens_af0832_force_reset_zero(HalLensAf0832 *dev);

/**
 * @brief Move lens by "zoom ratio" and "focus distance" using the AF0832 tracking table.
 *
 * Converts (zoom_ratio, focus_distance_m) to absolute zoom/focus target positions based on the
 * product spec table, using repository convention: 1 table step == 4 HAL steps.
 *
 * Mapping rules:
 * - zoom_ratio clamped to [1.00, 2.88], linearly interpolated between zoom rows.
 * - focus_distance_m:
 *   - <= 0 => INF column
 *   - otherwise clamped to [1.5, 10.0] meters and linearly interpolated between distance columns.
 * - focus step bilinear interpolation: distance interpolation inside each zoom row, then zoom interpolation.
 *
 * Execution:
 * - zoom_abs (wait) then focus_abs (wait).
 * - uses params.default_pps for both axes.
 */
int hal_lens_af0832_goto_by_ratio_distance(HalLensAf0832 *dev, float zoom_ratio, float focus_distance_m);

/**
 * Reverse-lookup: convert a HAL zoom position back to an optical zoom ratio
 * using the AF0832 calibration table with linear interpolation.
 */
float hal_lens_af0832_pos_to_ratio(int32_t hal_zoom_pos);

#ifdef __cplusplus
}
#endif

