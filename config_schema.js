// Homebridge plugin for Home Connect home appliances
// Copyright © 2019-2020 Alexander Thoukydides

'use strict';

const HomeConnectLanguages = require('./homeconnect_languages.json');
const Path = require('path');
const fsPromises = require('fs').promises;

// Platform identifier (must match index.js)
const PLATFORM_NAME = 'HomeConnect';

// Header and footer (may contain Markdown but not HTML tags)
const HEADER = 'For help please refer to the [README](https://github.com/thoukydides/homebridge-homeconnect/blob/master/README.md) and [`config.json`](https://github.com/thoukydides/homebridge-homeconnect/wiki/config.json).';
const HEADER_DEFAULT = '*This is a temporary configuration schema for initial setup only. When the plugin loads it will replace this schema with one tailored to your Home Connect appliances.*\n\n*If this message remains after the Home Connect Client has been configured then ensure that the plugin has write access to the schema file in its installation directory, otherwise it will not be possible to configure all features via this interface.*\n\n' + HEADER;
const FOOTER = '© 2019-2020 [Alexander Thoukydides](https://www.thouky.co.uk/)';

// Delay before writing the schema to allow multiple updates to be applied
const WRITE_DELAY = 3 * 1000; // (milliseconds)

// Schema generator for the Homebrifge config.json configuration file
class ConfigSchema {

    // Create a new schema generator
    constructor(log, persist) {
        this.logRaw = log;
        this.persist = persist;

        // The full path to the schema file
        this.schemaFile = Path.join(__dirname, 'config.schema.json');

        // Initial state
        this.appliances = {};

        // Read any previous schema and persistent state
        this.ready = this.readSchema();
    }

    // Client authorisation complete
    async setAuthorised() {
        await this.ready;
        this.authorisation = true;
        this.writeSchema();
    }

    // The user needs to visit a web page to authorise the client
    async setAuthorisationURI(uri) {
        await this.ready;
        this.authorisation = uri;
        this.writeSchema();
    }

    // Update the list of accessories
    async setAppliances(newAppliances) {
        await this.ready;
        this.authorisation = true;
        let appliances = {};
        for (let ha of newAppliances) {
            let appliance = Object.assign({}, this.appliances[ha.haId], ha);
            if (!appliance.programs) appliance.programs = [];
            appliances[ha.haId] = appliance;
        }
        this.appliances = appliances;
        this.writeSchema();
    }

    // Obtain the schema management for a single accessory
    getAppliance(haId) {

        // Locate the object for the specified program key
        let findProgram = programKey => {
            let appliance = this.appliances[haId];
            if (!appliance) return;
            return appliance.programs.find(p => p.key == programKey);
        }

        // Return the methods that the accessory can use to update the schema
        return {
            // Add the list of programs to the schema
            setPrograms: newPrograms => {
                let appliance = this.appliances[haId];
                if (!appliance) return;
                appliance.programs = newPrograms.map(program => {
                    let oldProgram = findProgram(program.key);
                    return Object.assign({}, oldProgram, program);
                });
                this.writeSchema();
            },

            // Add the options for a program to the schema
            setProgramOptions: (programKey, options) => {
                let program = findProgram(programKey);
                if (!program) return;
                program.options = options;
                this.writeSchema();
            }
        }
    }

    // Convert the supported Home Connect API languages into a schema
    getSchemaHomeConnectLanguages() {
        // Flatten the supported languages
        let languages = [];
        for (let language of Object.keys(HomeConnectLanguages)) {
            let countries = HomeConnectLanguages[language];
            let single = Object.keys(countries).length == 1;
            for (let country of Object.keys(countries)) {
                let tag = countries[country];
                let title = language;
                if (!single) title += ': ' + country + ' - ' + language;
                languages.push({
                    title:      title,
                    'const':    tag
                });
            }
        }

        // Return the configuration schema for the language choices
        return {
            type:       'string',
            'default':  'en-GB',
            oneOf:      languages,
            required:   true
        };
    }

    // Construct a schema for the Home Connect Client
    getSchemaClient() {
        let schema = {
            clientid: {
                type:       'string',
                minLength:  64,
                maxLength:  64,
                pattern:    '^[0-9A-Fa-f]+$',
                required:   true
            },
            simulator: {
                type:       'boolean',
                'default':  false,
                required:   true
            },
            language: {
                type:       'object',
                properties: {
                    api:    this.getSchemaHomeConnectLanguages()
                }
            }
        };
        let form = [{
            key:            'simulator',
            title:          'Client Type',
            type:           'select',
            titleMap: {
                false:      'Physical Appliances (production server)',
                true:       'Simulated Appliances (test server)'
            }
        },{
            key:            'clientid',
            title:          'Client ID',
            description:    'Create an application via the <a href="https://developer.home-connect.com/applications">Home Connect Developer Program</a>, with <strong>OAuth Flow</strong> set to <strong>Device Flow</strong>.',
            placeholder:    'e.g. 0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF',
            condition: {
                functionBody: 'return !model.simulator',
            }
        },{
            key:            'clientid',
            title:          'Client ID',
            description:    'Enter the Client ID for the automatically generated <a href="https://developer.home-connect.com/applications">API Web Client</a> to use the <a href="https://developer.home-connect.com/simulator">Appliance Simulators</a>.<br>Use this to test the functionality of this plugin without requiring access to physical appliances.',
            placeholder:    'e.g. 0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF',
            condition: {
                functionBody: 'return model.simulator',
            }
        },{
            key:            'language.api',
            title:          'API Language',
            description:    'This option currently only affects the language used to name the Switch services for programs. Changes to this setting make take 24 hours to apply if server results have been cached.',
            condition: {
                functionBody: 'return !model.simulator && model.clientid',
            }
        }];
        return {
            schema: schema,
            form:   form
        };
    }

    // Construct any authorisation help to include in the schema
    getSchemaAuthorisation() {
        if (this.authorisation === true) {

            // Authorisation complete
            return;

        } else if (this.authorisation) {

            // Authorisation is required via the provided URI
            return {
                type:       'help',
                helpvalue:  '<em class="primary-text">AUTHORISATION REQUIRED</em><br>To authorise this plugin to access your Home Connect appliances please visit:<div align=center><a href="' + this.authorisation + '">' + this.authorisation + '</a></div>'
            };

        } else {

            // Not authorised, so warn if using physical appliances
            return {
                type:       'help',
                helpvalue:  'This plugin will require authorisation to access Home Connect appliances.<br>The authorisation link will appear here (and in the Homebridge log file) after the Client ID has been configured and the plugin started.',
                condition: {
                    functionBody: 'return !model.simulator && model.clientid',
                }
            };
        }
    }

    // Construct a schema for an appliance
    getSchemaAppliance(appliance, keyPrefix) {
        let schema = {};
        let form = [{
            type:       'help',
            helpvalue:  appliance.brand + ' ' + appliance.type
                        + ' (E-Nr: ' + appliance.enumber + ')'
        }];

        // Add any programs supported by the appliance
        let programs = appliance.programs;
        if (programs.length) {
            let keyArrayPrefix = keyPrefix + '.programs[]';
            let keyConditionPrefix =
                'model["' + keyPrefix
                + '"].programs[arrayIndices[arrayIndices.length-1]]';

            // Values that are common to all programs
            let programForm = [{
                key:            keyArrayPrefix + '.name',
                title:          'HomeKit Name',
                description:    'This is the name that HomeKit will use to identify the program. Keep it short and simple. Avoid use of punctuation. Each program for this appliance must have a unique name.',
                placeholder:    'e.g. My ' + appliance.type + ' Program'
            },{
                key:            keyArrayPrefix + '.keyrow',
                type:           'section',
                type:           'flex',
                'flex-flow':    'row',
                notitle:        true,
                items: [{
                    key:            keyArrayPrefix + '.selectonly',
                    title:          'Action',
                    type:           'select',
                    titleMap: {
                        false:      'Start',
                        true:       'Select'
                    }
                },{
                    key:            keyArrayPrefix + '.key',
                    title:          'Program'
                }]
            }];

            // Add per-program options to the form
            let optionsSchema = {};
            for (let program of programs) {
                // Form condition to only show option for this program
                let formCondition = {
                    functionBody:
                        'try { return ' + keyConditionPrefix + '.key == "' + program.key + '"; } catch (err) { return false; }'
                };

                // Process each of the program's options
                for (let option of program.options || []) {
                    // Update the schema for this option
                    optionsSchema[option.key] = {
                        type:   option.type
                    };

                    // Add a form item to customise the schema
                    let schemaKey =
                        keyArrayPrefix + ".options.['" + option.key + "']";
                    let formOption = {
                        key:        schemaKey,
                        title:      option.name,
                        condition:  formCondition
                    }
                    for (let key of ['minimum', 'maximum', 'multipleOf']) {
                        if (option[key]) formOption[key] = option[key];
                    }
                    if (option.suffix) {
                        formOption.fieldAddonRight = '&nbsp;' + option.suffix;
                    }
                    if (option.values) {
                        formOption.titleMap = {};
                        for (let mapping of option.values) {
                            formOption.titleMap[mapping.key] = mapping.name;
                        }
                    }
                    if ('default' in option) {
                        let value = option['default'];
                        if (option.values) value = formOption.titleMap[value];
                        formOption.placeholder = 'e.g. ' + value;
                    }
                    programForm.push(formOption);
                }
            }

            // Add an array of programs to the schema
            schema.programs = {
                type:       'array',
                items: {
                    type:   'object',
                    properties: {
                        name: {
                            type:       'string',
                            required:   true
                        },
                        key: {
                            type:       'string',
                            oneOf:      programs.map(program => ({
                                title:      program.name,
                                'const':    program.key
                            })),
                            required:   true
                        },
                        selectonly: {
                            type:       'boolean',
                            required:   true,
                            'default':  false
                        },
                        options: {
                            type:       'object',
                            properties: optionsSchema
                        }
                    }
                }
            };
            form.push({
                key:        keyPrefix + ".programs",
                notitle:    true,
                startEmpty: true,
                items:      programForm
            });
        }

        // Return the schema for this appliance
        return {
            schema: {
                type:       'object',
                properties: schema
            },
            form:   form
        };
    }

    // Construct the complete configuration schema
    getSchema() {
        let schema = {
            type:       'object',
            properties: {}
        };
        let form = [];

        // Add the Home Connect Client
        let clientSchema = this.getSchemaClient();
        Object.assign(schema.properties, clientSchema.schema);
        form.push({
            type:         'fieldset',
            title:        'Home Connect Client',
            expandable:   false,
            items:        clientSchema.form
        });

        // Add any Home Connect authorisation
        let authForm = this.getSchemaAuthorisation();
        if (authForm) clientSchema.form.push(authForm);

        // Per-appliance configuration
        let appliances = Object.values(this.appliances).sort(
            (a, b) => a.name.localeCompare(b.name));
        for (let appliance of appliances) {
            let keyPrefix = appliance.haId;
            let appSchema = this.getSchemaAppliance(appliance, keyPrefix);
            schema.properties[appliance.haId] = appSchema.schema;
            form.push({
                type:         'fieldset',
                title:        appliance.name,
                expandable:   true,
                expanded:     false,
                items:        appSchema.form
            });
        }

        // Return the schema
        return {
            pluginAlias:    PLATFORM_NAME,
            pluginType:     'platform',
            singular:       true,
            headerDisplay:  this.persist ? HEADER : HEADER_DEFAULT,
            footerDisplay:  FOOTER,
            schema:         schema,
            form:           form,
            display:        null
        };
    }

    // Read any existing schema file
    async readSchema() {
        // First read any persistent data
        if (this.persist) {
            let persist = await this.persist.getItem('config.schema.json');
            if (persist) Object.assign(this, persist);
        }

        // Then try reading a schema file
        try {
            let data = await fsPromises.readFile(this.schemaFile, 'utf8');
            this.oldSchema = data;
        } catch (err) {
            this.warn('Failed to read the current configuration schema: '
                       + err.message);
        }
    }

    // Schedule writing a new schema file, if changed
    writeSchema() {
        // Perform the write
        let doWrite = async () => {
            let promises = this.writePending;
            delete this.writePending;

            // Write the schema and resolve all pending promises
            await this.writeSchemaDeferred();
            for (let promise of promises) promise.resolve();

            // Schedule another write if required
            if (this.writePending) {
                this.debug('Scheduling overlapping configuration schema write');
                this.writeScheduled = setTimeout(doWrite, WRITE_DELAY);
            } else {
                this.debug('Scheduled configuration schema write complete');
                delete this.writeScheduled;
            }
        }
        if (!this.writePending) {
            this.writePending = [];
            if (!this.writeScheduled) {
                this.debug('Scheduling configuration schema write');
                this.writeScheduled = setTimeout(doWrite, WRITE_DELAY);
            }
        }

        // Create and return a promise for this request
        return new Promise((resolve, reject) => {
            this.writePending.push({resolve: resolve, reject: reject});
        });
    }

    // Write a new schema file, if changed
    async writeSchemaDeferred() {
        await this.ready;

        // First write persistent data
        if (this.persist) {
            await this.persist.setItem('config.schema.json', {
                authorisation:  this.authorisation,
                appliances:     this.appliances
            });
        }

        // Construct the new schema
        let schema = this.getSchema();
        let data = JSON.stringify(schema, null, 4);

        // No action required unless the schema has changed
        if (data == this.oldSchema) return;

        // Attempt to write the new schema
        try {
            await fsPromises.writeFile(this.schemaFile, data, 'utf8');
            this.oldSchema = data;
            this.log('Configuration schema file updated:');
            this.log('    ' + this.schemaFile);
        } catch (err) {
            this.warn('Failed to write a new configuration schema: '
                      + err.message);
            if (err.code === 'EACCES') {
                this.warn('Make the file writable by the Homebridge process:');
                this.warn('    chmod a+rw ' + this.schemaFile);
            }
        }
    }

    // Logging
    error(msg)  { this.logRaw ? this.logRaw.error(msg) : console.error(msg); }
    warn(msg)   { this.logRaw ? this.logRaw.warn(msg)  : console.warn(msg);  }
    log(msg)    { this.logRaw ? this.logRaw.info(msg)  : console.log(msg);   }
    debug(msg)  { this.logRaw ? this.logRaw.debug(msg) : console.debug(msg); }
}
module.exports = ConfigSchema;

// If this script is being run interactively then generate the default schema
if (!module.parent) {
    let schema = new ConfigSchema;
    schema.writeSchema();
}
