define([
  'jquery',
  'async',
  'jquery_iframe',
  'jquery_fileupload',
  'underscore',
  'backbone',
  'utilities',
  'tag_show_view',
  'text!profile_show_template',
  'text!profile_email_template',
  'modal_component',
  'profile_activity_view',
  'profile_email_view'
], function ($, async, jqIframe, jqFU, _, Backbone, utils,
  TagShowView, ProfileTemplate, EmailTemplate, ModalComponent, PAView, EmailFormView) {

  var ProfileShowView = Backbone.View.extend({

    events: {
      "submit #profile-form"       : "profileSubmit",
      "click #profile-save"        : "profileSave",
      "click #profile-edit"        : "profileEdit",
      "click #profile-cancel"      : "profileCancel",
      "click #like-button"         : "like",
      "keyup #name, #title, #bio" : "fieldModified",
      "click #add-email"           : "addEmail",
      "click .email-remove"        : "removeEmail",
      "click .removeAuth"          : "removeAuth"
    },

    initialize: function (options) {
      this.options = options;
      this.data = options.data;
      this.edit = false;
      if (this.options.routeId) {
        if (this.options.routeId == 'edit') {
          this.edit = true;
        }
      }
      if (this.data.saved) {
        this.saved = true;
        this.data.saved = false;
      }
    },

    render: function () {
      var data = {
        data: this.model.toJSON(),
        edit: this.edit,
        saved: this.saved
      }
      var template = _.template(ProfileTemplate, data);
      this.$el.html(template);

      this.initializeFileUpload();
      this.initializeForm();
      this.initializeSelect2();
      this.initializeLikes();
      this.initializeTags();
      this.initializePAView();
      this.initializeEmail();
      this.updatePhoto();
      this.updateProfileEmail();
      return this;
    },

    initializeFileUpload: function () {
      var self = this;

      $('#fileupload').fileupload({
          url: "/api/file/create",
          dataType: 'text',
          acceptFileTypes: /(\.|\/)(gif|jpe?g|png)$/i,
          formData: { 'type': 'image_square' },
          add: function (e, data) {
            $('#file-upload-progress-container').show();
            data.submit();
          },
          progressall: function (e, data) {
            var progress = parseInt(data.loaded / data.total * 100, 10);
            $('#file-upload-progress').css(
              'width',
              progress + '%'
            );
          },
          done: function (e, data) {
            // for IE8/9 that use iframe
            if (data.dataType == 'iframe text') {
              var result = JSON.parse(data.result);
            }
            // for modern XHR browsers
            else {
              var result = JSON.parse($(data.result).text());
            }
            self.model.trigger("profile:updateWithPhotoId", result[0]);
          }
      });

    },

    updateProfileEmail: function(){
      var self = this;
      $.ajax({
        url: '/api/email/makeURL?email=contactUserAboutProfile&subject=Check Out "'+ self.model.attributes.name + '"' +
        '&profileTitle=' + (self.model.attributes.title || '') +
        '&profileLink=' + window.location.protocol + "//" + window.location.host + "" + window.location.pathname +
        '&profileName=' + (self.model.attributes.name || '') +
        '&profileLocation=' + (self.model.attributes.location ? self.model.attributes.location.tag.name : '') +
        '&profileAgency=' + (self.model.agency ? self.model.agency.name : ''),
        type: 'GET'
      }).done( function (data) {
        self.$('#email').attr('href', data);
      });
    },

    initializeTags: function() {
      if (this.tagView) { this.tagView.cleanup(); }
      this.tagView = new TagShowView({
        model: this.model,
        el: '.tag-wrapper',
        target: 'profile',
        edit: this.edit,
        url: '/api/tag/findAllByUserId/'
      });
      this.tagView.render();
    },

    initializePAView: function () {
      if (this.projectView) { this.projectView.cleanup(); }
      if (this.taskView) { this.taskView.cleanup(); }
      $.ajax('/api/user/activities/' + this.model.attributes.id).done(function (data) {
        this.projectView = new PAView({
          model: this.model,
          el: '.project-activity-wrapper',
          target: 'project',
          data: data.projects
        });
        this.projectView.render();
        this.taskView = new PAView({
          model: this.model,
          el: '.task-activity-wrapper',
          target: 'task',
          data: data.tasks
        });
        this.taskView.render();

      });
    },

    updatePhoto: function () {
      this.model.on("profile:updatedPhoto", function (data) {
        var url = '/api/user/photo/' + data.attributes.id;
        // force the new image to be loaded
        $.get(url, function (data) {
          $("#project-header").css('background-image', "url('" + url + "')");
          $('#file-upload-progress-container').hide();
          // notify listeners of the new user image
          window.cache.userEvents.trigger("user:profile:photo:save", url);
        });
      });
    },

    initializeForm: function() {
      var self = this;

      this.listenTo(self.model, "profile:save:success", function (data) {
        $("#submit").button('success');
        // Bootstrap .button() has execution order issue since it
        // uses setTimeout to change the text of buttons.
        // make sure attr() runs last
        window.cache.userEvents.trigger("user:profile:save", data.toJSON());

        var tags = [
          $("#company").select2('data'),
          $("#location").select2('data')
        ];
        self.model.trigger("profile:tags:save", tags);
      });
      this.listenTo(self.model, "profile:tags:save", function (tags) {
        var removeTag = function(type, done) {
          if (self.model[type]) {
            // if it is already stored, abort.
            if (self.model[type].tagId) {
              return done();
            }
            $.ajax({
              url: '/api/tag/' + self.model[type].tagId,
              type: 'DELETE',
            }).done(function (data) {
              return done();
            });
            return;
          }
          return done();
        }

        var addTag = function (tag, done) {
          // the tag is invalid or hasn't been selected
          if (!tag || !tag.id) {
            return done();
          }
          // the tag already is stored in the db
          if (tag.tagId) {
            return done();
          }
          var tagMap = {
            tagId: tag.id
          };
          $.ajax({
            url: '/api/tag',
            type: 'POST',
            data: tagMap
          }).done(function (data) {
            done();
          });
        }

        async.each(['agency','location'], removeTag, function (err) {
          async.each(tags, addTag, function (err) {
            return self.model.trigger("profile:tags:save:success", err);
          });
        });
      });
      this.listenTo(self.model, "profile:tags:save:success", function (data) {
        setTimeout(function() { $("#profile-save, #submit").attr("disabled", "disabled") }, 0);
        $("#profile-save, #submit").removeClass("btn-primary");
        $("#profile-save, #submit").addClass("btn-success");
        self.data.saved = true;
        Backbone.history.navigate('profile', { trigger: true });
      });
      this.listenTo(self.model, "profile:save:fail", function (data) {
        $("#submit").button('fail');
      });
      this.listenTo(self.model, "profile:removeAuth:success", function (data, id) {
        self.render();
      });
      this.listenTo(self.model, "profile:input:changed", function (e) {
        $("#profile-save, #submit").button('reset');
        $("#profile-save, #submit").removeAttr("disabled");
        $("#profile-save, #submit").removeClass("btn-success");
        $("#profile-save, #submit").addClass("btn-c2");
      });
    },

    initializeLikes: function() {
      $("#like-number").text(this.model.attributes.likeCount);
      if (parseInt(this.model.attributes.likeCount) === 1) {
        $("#like-text").text($("#like-text").data('singular'));
      } else {
        $("#like-text").text($("#like-text").data('plural'));
      }
      if (this.model.attributes.like) {
        $("#like-button-icon").removeClass('icon-star-empty');
        $("#like-button-icon").addClass('icon-star');
      }
    },

    initializeSelect2: function () {
      var self = this;
      var formatResult = function (object, container, query) {
        return object.name;
      };

      var modelJson = this.model.toJSON();
      $("#company").select2({
        placeholder: 'Select an Agency',
        formatResult: formatResult,
        formatSelection: formatResult,
        minimumInputLength: 2,
        ajax: {
          url: '/api/ac/tag',
          dataType: 'json',
          data: function (term) {
            return {
              type: 'agency',
              q: term
            };
          },
          results: function (data) {
            return { results: data };
          }
        }
      });
      if (modelJson.agency) {
        $("#company").select2('data', modelJson.agency.tag);
      }
      $("#company").on('change', function (e) {
        self.model.trigger("profile:input:changed", e);
      });
      $("#location").select2({
        placeholder: 'Select a Location',
        formatResult: formatResult,
        formatSelection: formatResult,
        minimumInputLength: 1,
        data: [ location ],
        ajax: {
          url: '/api/ac/tag',
          dataType: 'json',
          data: function (term) {
            return {
              type: 'location',
              q: term
            };
          },
          results: function (data) {
            return { results: data };
          }
        }
      });
      if (modelJson.location) {
        $("#location").select2('data', modelJson.location.tag);
      }
      $("#location").on('change', function (e) {
        self.model.trigger("profile:input:changed", e);
      });
    },

    initializeEmail: function () {
      var modelJson = this.model.toJSON();
      if (this.edit) {
        for (var i in modelJson.emails) {
          var template = _.template(EmailTemplate, { email: modelJson.emails[i] });
          $("#profile-emails").append(template);
        }
      }
      // New tags added in to the DB via the modal
      this.model.listenTo(this.model, "profile:email:new", function (data) {
        // Destory modal
        $(".modal").modal('hide');
        // Add tag into the data list
        var template = _.template(EmailTemplate, { email: data });
        $("#profile-emails").append(template);
      });

      this.model.listenTo(this.model, "profile:email:error", function (data) {
        // nothing to be done
      });

      this.listenTo(this.model, "profile:email:delete", function (e) {
        $(e.currentTarget).parents('div.radio').remove();
      });
    },

    fieldModified: function (e) {
      this.model.trigger("profile:input:changed", e);
    },

    profileCancel: function (e) {
      e.preventDefault();
      Backbone.history.navigate('profile', { trigger: true });
    },

    profileEdit: function (e) {
      e.preventDefault();
      Backbone.history.navigate('profile/edit', { trigger: true });
    },

    profileSave: function (e) {
      e.preventDefault();
      $("#profile-form").submit();
    },

    profileSubmit: function (e) {
      e.preventDefault();
      $("#profile-save, #submit").button('loading');
      setTimeout(function() { $("#profile-save, #submit").attr("disabled", "disabled") }, 0);
      var data = {
        name: $("#name").val(),
        title: $("#title").val(),
        bio: $("#bio").val()
      };
      this.model.trigger("profile:save", data);
    },

    removeAuth: function (e) {
      if (e.preventDefault) e.preventDefault();
      var node = $(e.target);
      // walk up the tree until we get to the marked node
      while (!(node.hasClass("removeAuth"))) {
        node = node.parent();
      }
      this.model.trigger("profile:removeAuth", node.attr("id"));
    },

    addEmail: function (e) {
      if (e.preventDefault) e.preventDefault();
      var self = this;

      // Pop up dialog box to create tag,
      // then put tag into the select box
      if (this.emailFormView) this.emailFormView.cleanup();
      if (this.emailModalComponent) this.emailModalComponent.cleanup();
      this.emailModalComponent = new ModalComponent({
        el: "#emailModal",
        id: "addEmail",
        modalTitle: "Add Email Address"
      }).render();
      this.emailFormView = new EmailFormView({
        el: "#addEmail .modal-template",
        model: self.model,
        target: 'profile'
      });
      this.emailFormView.render();
    },

    removeEmail: function (e) {
      if (e.preventDefault) e.preventDefault();
      var self = this;
      // Get the data-id of the currentTarget
      // and then call HTTP DELETE on that tag id
      $.ajax({
        url: '/api/useremail/' + $(e.currentTarget).data('id'),
        type: 'DELETE',
      }).done(function (data) {
        self.model.trigger("profile:email:delete", e);
      });

    },

    like: function (e) {
      e.preventDefault();
      var self = this;
      var child = $(e.currentTarget).children("#like-button-icon");
      var likenumber = $("#like-number");
      // Not yet liked, initiate like
      if (child.hasClass('icon-star-empty')) {
        child.removeClass('icon-star-empty');
        child.addClass('icon-star');
        likenumber.text(parseInt(likenumber.text()) + 1);
        if (parseInt(likenumber.text()) === 1) {
          $("#like-text").text($("#like-text").data('singular'));
        } else {
          $("#like-text").text($("#like-text").data('plural'));
        }
        $.ajax({
          url: '/api/like/likeu/' + self.model.attributes.id
        }).done( function (data) {
          // liked!
          // response should be the like object
          // console.log(data.id);
        });
      }
      // Liked, initiate unlike
      else {
        child.removeClass('icon-star');
        child.addClass('icon-star-empty');
        likenumber.text(parseInt(likenumber.text()) - 1);
        if (parseInt(likenumber.text()) === 1) {
          $("#like-text").text($("#like-text").data('singular'));
        } else {
          $("#like-text").text($("#like-text").data('plural'));
        }
        $.ajax({
          url: '/api/like/unlikeu/' + self.model.attributes.id
        }).done( function (data) {
          // un-liked!
          // response should be null (empty)
        });
      }
    },
    cleanup: function () {
      if (this.tagView) { this.tagView.cleanup(); }
      if (this.projectView) { this.projectView.cleanup(); }
      if (this.taskView) { this.taskView.cleanup(); }
      removeView(this);
    },

  });

  return ProfileShowView;
});
