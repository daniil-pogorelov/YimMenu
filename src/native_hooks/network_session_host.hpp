#pragma once
#include "native_hooks.hpp"
#include "natives.hpp"
#include "pointers.hpp"
#include <rage/rlScHandle.hpp>

namespace big
{
	namespace network
	{
		inline void NETWORK_SESSION_HOST(rage::scrNativeCallContext* src)
		{
			if (g.session.join_queued)
			{
				if (g.session.target_rid != 0) {
					rage::rlGamerHandle target_handle(g.session.target_rid);
					g_pointers->m_gta.m_join_session_by_info(*g_pointers->m_gta.m_network, &g.session.info, g.session.join_in_sctv_slots ? 1 : 0, 1 | 2, &target_handle, 1);
				} else {
					g_pointers->m_gta.m_join_session_by_info(*g_pointers->m_gta.m_network, &g.session.info, g.session.join_in_sctv_slots ? 1 : 0, 1 | 2, nullptr, 0);
				}
				
				g.session.join_queued = false;
				g.session.target_rid = 0;
				src->set_return_value<BOOL>(TRUE);
			}
			else
			{
				src->set_return_value<BOOL>(NETWORK::NETWORK_SESSION_HOST(src->get_arg<int>(0), src->get_arg<int>(1), src->get_arg<BOOL>(2)));
			}
		}
	}
}
