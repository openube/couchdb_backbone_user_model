/*jslint white: true, vars: true*/
/*global console, Backbone, jQuery, _*/

(function(Backbone, $, _) {
    "use strict";

    if (Backbone.CouchDB_User) {
        throw new Error("Backbone.CouchDB_User was already loaded.");
    }

    if (!Backbone || !$ || !$.couch) {
        throw new Error("All dependencies have not been loaded.");
    }

    var priv = {};

    priv.isNullOrUndefined = function(val) {
        return val === null || val === undefined;
    }

    var con;

    Backbone.couch_user_connector = con = {
        config: {
            db_name: "_users" //have a feeling this isn't used
        },
        helpers: {
            make_db: function() {
                var db = $.couch.db(con.config.db_name);

                if (!priv.isNullOrUndefined(con.config.base_url)) {
                    db.uri = "" + con.config.base_url + "/" + con.config.db_name + "/";
                }

                return db;
            }
        },
        read: function(model, opts) {
            return con.read_model(model, opts);
        },
        read_model: function(model, opts) {
            if (!model.id) {
                throw new Error("The model has no id property, so it can't get fetched from the database");
            }
            return this.helpers.make_db().openDoc(model.id, {
                success: function(doc) {
                    opts.success(doc);
                    return opts.complete();
                },
                error: function(status, error, reason) {
                    var res;
                    res = {
                        status: status,
                        error: error,
                        reason: reason
                    };
                    opts.error(res);
                    return opts.complete(res);
                }
            });
        },
        create: function(model, opts) {
            var coll, vals;
            vals = model.toJSON();
            return this.helpers.make_db().saveDoc(vals, {
                success: function(doc) {
                    opts.success({
                        _id: doc.id,
                        _rev: doc.rev
                    });
                    return opts.complete();
                },
                error: function(status, error, reason) {
                    var res;
                    res = {
                        status: status,
                        error: error,
                        reason: reason
                    };
                    opts.error(res);
                    return opts.complete(res);
                }
            });
        },
        update: function(model, opts) {
            return this.create(model, opts);
        },
        del: function(model, opts) {
            return this.helpers.make_db().removeDoc(model.toJSON(), {
                success: function() {
                    return opts.success();
                },
                error: function(nr, req, e) {
                    var res;
                    if (e === "deleted") {
                        opts.success();
                        return opts.complete();
                    } else {
                        // TODO: status, error and reason are not defined in this scope
                        res = {
                            status: status,
                            error: error,
                            reason: reason
                        };
                        opts.error(res);
                        return opts.complete(res);
                    }
                }
            });
        }
    };


    Backbone.CouchDB_User = Backbone.Model.extend({
        url: function() {
            return '_users/' + 'org.couchdb.user:' + this.name;
        },
        sync: function(method, model, opts) {
            opts.success = opts.success || $.noop;
            opts.error = opts.error || $.noop;
            opts.complete = opts.complete || $.noop;

            switch (method) {
            case "read":
                return con.read(model, opts);
            case "create":
                return con.create(model, opts);
            case "update":
                return con.update(model, opts);
            case "delete":
                return con.del(model, opts);
            }
        },
        signup: function() {
            var user_model = this;
            var user_data = user_model.toJSON();
            var password = user_data.password;
            var password_confirm = user_data.password_confirm;
            delete user_data.password;
            delete user_data.password_confirm;

            var errors = {};
            if (password === null || password === undefined || password === "") {
                errors["password_empty"] = "A password is required";
            }
            if (!password_confirm || password !== password_confirm) {
                errors["password_confirm"] = "Passwords do not match";
            }
            if (!user_data.name) {
                errors["name"] = "Name is required";
            }

            if (_.isEmpty(errors)) {
                var error_handler = function(status, error, reason) {
                        console.log(status);
                    };

                $.couch.signup(user_data, password, {
                    error: error_handler
                }).done(function(a, b, c) {
                    user_model.trigger('registered', user_model);
                }).fail(function(a, b, c) {
                    user_model.trigger('error:registered');
                });
            } else {
                user_model.trigger('error:registered', errors);
            }
        },
        session: function(options) {
            var user_model = this;

            var deferred = new $.Deferred();

            // Wrapping resolve and reject to make sure the triggered events are consistent
            function resolve(){
                // TODO: data must be loaded for this to be triggered with data
                //user_model.trigger('session', user_model);
                user_model.trigger('session');

                deferred.resolve();
            }

            function reject(errorObject){
                user_model.trigger('error:session', errorObject);

                deferred.reject();
            }

            $.couch.session().done(function(resp) {
                if (!(resp && resp.userCtx && resp.userCtx.name)) {
                    var no_user_session_error = new Error("The user has no session.");

                    reject(no_user_session_error);
                } else {
                    var model_user_name = user_model.user_name;
                    var session_user_name = resp.userCtx.name;

                    // Check if the session matches the loaded data?
                    if (priv.isNullOrUndefined(model_user_name)) {
                        user_model.set({
                            // Store session
                            "user_name": session_user_name
                        });
                    } else {
                        if (session_user_name !== model_user_name) {

                            var user_name_mismatch_error = new Error("The user session's user name didn't match the loaded model's user name.", {
                                "session_user_name": session_user_name,
                                "model_user_name": model_user_name,
                            });

                            reject(user_name_mismatch_error);
                        }
                    }

                    resolve();
                }
            });

            return deferred.promise();
        },
        login: function() {
            var user_model = this;
            var user_name = user_model.get('name');
            var name_pass = _.pick(user_model.toJSON(), 'name', 'password');

            var deferred = new $.Deferred();

            $.couch.login(name_pass).done(function() {
                user_model.trigger('loggedin');
            }).done(deferred.resolve).fail(function() {
                user_model.trigger('error:loggedin');
            }).fail(deferred.reject);

            return deferred.promise();
        },
        fillWithData: function() {
            var user_model = this;

            return $.when($.couch.userDb()).pipe(function(user_db) {
                var deferred = new $.Deferred();

                user_db.openDoc("org.couchdb.user:" + user_model.get("user_name"), {
                    success: deferred.resolve,
                    error: deferred.reject
                });

                // TODO DEBUG: remove
                deferred.done(function() {
                    console.log("fillWithData", "done", arguments);
                }).fail(function() {
                    console.error("fillWithData", "fail", arguments);
                });

                return deferred.promise();
            }).pipe(function(userDoc) {
                console.log("userDoc", userDoc);
                user_model.set(userDoc);

                // TODO: namespace with .fromserver?
                user_model.trigger('filledwithdatafromserver', user_model);

                return user_model;
            });
        },
        ensureFilledWithData: function() {
            var user_model = this;

            var gotDataDeferred = new $.Deferred();

            // TODO: construct a test to see if the data was loaded.
            // Duck typing, I guess.
            //if (user_model.hasSomethingSimpleToTest) {
            //    // Resolve right away
            //    gotDataDeferred.resolve();
            //} else {
            user_model.fillWithData().done(function() {
                // TODO: namespace differently from .fromserver?
                user_model.trigger('filledwithdata', user_model);
            }).done(gotDataDeferred.resolve).fail(gotDataDeferred.reject);
            //}
            return gotDataDeferred.promise();
        },
        logout: function() {
            var user_model = this;
            user_model.clear({
                silent: true
            });
            $.couch.logout().done(_.bind(user_model.trigger, user_model, 'loggedout')).fail(_.bind(user_model.trigger, user_model, 'error:loggedout'));
        },
        change_password: function(new_password) {
            var user_model = this;
            return $.when(user_model.save({
                password: new_password
            })).pipe(_.bind(user_model.login, user_model)).done(_.bind(user_model.trigger, user_model, "password-changed")).fail(_.bind(user_model.trigger, user_model, "error:password-changed"));
        }
    });
}(Backbone, jQuery, _));