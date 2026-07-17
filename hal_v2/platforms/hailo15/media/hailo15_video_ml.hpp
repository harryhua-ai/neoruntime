/**
 * @file hailo15_video_ml.hpp
 * @brief MediaLibrary profile updates for frontend streams (resolution / fps / format / pool).
 */
#pragma once

#include "hailo15_codec_ml.hpp"
#include "hailo15_common.hpp"
#include "hailo15_media_priv.hpp"
#include "hailo15_osd_ml.hpp"

#include "media/hal_media_internal.h"
#include "media/hal_video_internal.h"

#include <hailo/media_library/media_library.hpp>

#include <cstdint>
#include <optional>
#include <string>
#include <utility>

namespace hailo15::video_ml
{

inline void clear_encoder_osd(config_profile_t &p, const std::string *stream_id)
{
    for (auto &kv : p.encoded_output_streams)
    {
        if (stream_id && kv.first != *stream_id)
        {
            continue;
        }
        /* Minimal safety: drop OSD overlays when geometry changes.
         * Full alignment with webserver would rescale / reposition overlays instead of clearing them. */
        kv.second.osd.image_overlays.clear();
        kv.second.osd.text_overlays.clear();
        kv.second.osd.datetime_overlays.clear();
    }
}

inline HailoFormat hal_pixel_to_hailo(HalPixelFormat f)
{
    switch (f)
    {
        case HAL_PIX_FMT_NV12:
            return HAILO_FORMAT_NV12;
        case HAL_PIX_FMT_GRAY8:
            return HAILO_FORMAT_GRAY8;
        case HAL_PIX_FMT_RGB24:
            return HAILO_FORMAT_RGB;
        case HAL_PIX_FMT_ARGB32:
            return HAILO_FORMAT_ARGB;
        default:
            return HAILO_FORMAT_NV12;
    }
}

inline void apply_profile_to_video_ctx(HalVideoContext *vc, const config_profile_t &prof, const char *stream_id)
{
    if (!vc || !stream_id)
    {
        return;
    }
    for (const auto &res : prof.application_settings.application_input_streams.resolutions)
    {
        if (res.stream_id == stream_id)
        {
            vc->config.width = res.dimensions.destination_width;
            vc->config.height = res.dimensions.destination_height;
            vc->config.framerate = res.framerate;
            vc->config.format = hailo_format_to_hal(prof.application_settings.application_input_streams.format);
            vc->config.pool_max_buffers = res.pool_max_buffers;
            return;
        }
    }
}

inline void apply_profile_to_codec_ctx(HalCodecContext *cc, const config_profile_t &prof)
{
    if (!cc)
    {
        return;
    }
    const std::string eid = cc->codec_name;
    auto it = prof.encoded_output_streams.find(eid);
    if (it != prof.encoded_output_streams.end())
    {
        void *mp = cc->config.media_ptr;
        hailo15::ml::fill_hal_codec_config(cc, eid, it->second, mp);
    }
}

inline void refresh_all_context_configs(Hailo15MediaPriv *priv, HalMediaContext *hm)
{
    auto prof_exp = priv->media_lib->get_current_profile();
    if (!prof_exp || !hm->video_ctx_list || !hm->codec_ctx_list)
    {
        return;
    }
    const config_profile_t &prof = prof_exp.value();
    const HalStatus pipe_st = priv->pipeline_started ? HAL_STATUS_RUNNING : HAL_STATUS_INITIALIZED;
    for (uint32_t i = 0; i < hm->video_ctx_list_count; i++)
    {
        auto *vc = static_cast<HalVideoContext *>(hm->video_ctx_list[i]);
        apply_profile_to_video_ctx(vc, prof, vc->video_name);
        vc->status = pipe_st;
    }
    for (uint32_t i = 0; i < hm->codec_ctx_list_count; i++)
    {
        auto *cc = static_cast<HalCodecContext *>(hm->codec_ctx_list[i]);
        apply_profile_to_codec_ctx(cc, prof);
        cc->status = pipe_st;
    }
}

/**
 * Updates one frontend output_resolution_t and optionally global input format, then set_override_parameters().
 */
inline int apply_frontend_stream_override(const MediaLibraryPtr &ml, const std::string &stream_id,
                                          const std::optional<std::pair<uint32_t, uint32_t>> &resolution,
                                          const std::optional<uint32_t> &framerate,
                                          const std::optional<HalPixelFormat> &format,
                                          const std::optional<uint32_t> &pool_max,
                                          Hailo15MediaPriv *priv_for_osd = nullptr)
{
    auto prof_exp = ml->get_current_profile();
    if (!prof_exp)
    {
        return HAL_ERROR;
    }
    config_profile_t p = prof_exp.value();
    bool found = false;
    uint32_t new_w = 0U;
    uint32_t new_h = 0U;
    for (auto &res : p.application_settings.application_input_streams.resolutions)
    {
        if (res.stream_id != stream_id)
        {
            continue;
        }
        found = true;
        if (resolution.has_value())
        {
            const auto [w, h] = resolution.value();
            if (w > 0U && h > 0U)
            {
                res.dimensions.destination_width = w;
                res.dimensions.destination_height = h;
                new_w = w;
                new_h = h;
            }
        }
        if (framerate.has_value() && framerate.value() > 0U)
        {
            res.framerate = framerate.value();
        }
        if (pool_max.has_value())
        {
            res.pool_max_buffers = pool_max.value();
        }
        break;
    }
    if (!found)
    {
        return HAL_ERR_INVALID_STATE;
    }

    /* Keep encoder input dimensions in sync for matching stream id (typical 1:1 sinkX mapping). */
    if (new_w > 0U && new_h > 0U)
    {
        for (auto &kv : p.encoded_output_streams)
        {
            if (kv.first == stream_id)
            {
                std::visit(
                    [&](auto &enc) {
                        enc.input_stream.width = new_w;
                        enc.input_stream.height = new_h;
                    },
                    kv.second.encoding);
            }
        }
        /* Rescale OSD overlays to the new resolution (webserver-aligned font-size rescaling). */
        if (priv_for_osd)
        {
            hailo15::osd_ml::recalculate_osd_on_layout_change(priv_for_osd, stream_id, new_w, new_h,
                                                               HAL_ROTATION_ANGLE_0);
        }
        else
        {
            hailo15::osd_ml::clear_encoder_osd(p, &stream_id);
        }
    }

    if (format.has_value())
    {
        p.application_settings.application_input_streams.format = hal_pixel_to_hailo(format.value());
    }

    media_library_return r = ml->set_override_parameters(p);
    if (r != MEDIA_LIBRARY_SUCCESS)
    {
        return hailo15_ml_err(r);
    }
    return HAL_OK;
}

} // namespace hailo15::video_ml
