// Homebridge plugin for Home Connect home appliances
// Copyright © 2019-2023 Alexander Thoukydides

import { API } from 'homebridge';

import { PLATFORM_NAME } from './settings';
import { HomeConnectPlatform } from './platform';

// Register the platform with Homebridge
export = (api: API) => api.registerPlatform(PLATFORM_NAME, HomeConnectPlatform);