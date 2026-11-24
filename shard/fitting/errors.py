# -*- coding: utf-8 -*-
"""共享异常。"""


class ConfigError(ValueError):
    """JSON 配置不合法时抛出，消息里会带可用取值。"""
