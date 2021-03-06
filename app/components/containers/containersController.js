angular.module('containers', [])
  .controller('ContainersController', ['$q', '$scope', '$filter', 'Container', 'ContainerHelper', 'Info', 'Settings', 'Notifications', 'Config', 'Pagination', 'EntityListService', 'ModalService', 'Authentication', 'ResourceControlService', 'UserService',
  function ($q, $scope, $filter, Container, ContainerHelper, Info, Settings, Notifications, Config, Pagination, EntityListService, ModalService, Authentication, ResourceControlService, UserService) {
  $scope.state = {};
  $scope.state.pagination_count = Pagination.getPaginationCount('containers');
  $scope.state.displayAll = Settings.displayAll;
  $scope.state.displayIP = false;
  $scope.sortType = 'State';
  $scope.sortReverse = false;
  $scope.state.selectedItemCount = 0;
  $scope.order = function (sortType) {
    $scope.sortReverse = ($scope.sortType === sortType) ? !$scope.sortReverse : false;
    $scope.sortType = sortType;
  };

  $scope.changePaginationCount = function() {
    Pagination.setPaginationCount('containers', $scope.state.pagination_count);
  };

  function removeContainerResourceControl(container) {
    volumeResourceControlQueries = [];
    angular.forEach(container.Mounts, function (volume) {
      volumeResourceControlQueries.push(ResourceControlService.removeVolumeResourceControl(container.Metadata.ResourceControl.OwnerId, volume.Name));
    });

    $q.all(volumeResourceControlQueries)
    .then(function success() {
      return ResourceControlService.removeContainerResourceControl(container.Metadata.ResourceControl.OwnerId, container.Id);
    })
    .then(function success() {
      delete container.Metadata.ResourceControl;
      Notifications.success('Ownership changed to public', container.Id);
    })
    .catch(function error(err) {
      Notifications.error("Failure", err, "Unable to change container ownership");
    });
  }

  $scope.switchOwnership = function(container) {
    ModalService.confirmContainerOwnershipChange(function (confirmed) {
      if(!confirmed) { return; }
      removeContainerResourceControl(container);
    });
  };

  function mapUsersToContainers(users) {
    angular.forEach($scope.containers, function (container) {
      if (container.Metadata) {
        var containerRC = container.Metadata.ResourceControl;
        if (containerRC && containerRC.OwnerId !== $scope.user.ID) {
          angular.forEach(users, function (user) {
            if (containerRC.OwnerId === user.Id) {
              container.Owner = user.Username;
            }
          });
        }
      }
    });
  }

  var update = function (data) {
    $('#loadContainersSpinner').show();
    var userDetails = Authentication.getUserDetails();
    $scope.user = userDetails;
    $scope.state.selectedItemCount = 0;
    Container.query(data, function (d) {
      var containers = d;
      if ($scope.containersToHideLabels) {
        containers = ContainerHelper.hideContainers(d, $scope.containersToHideLabels);
      }
      $scope.containers = containers.map(function (container) {
        var model = new ContainerViewModel(container);
        model.Status = $filter('containerstatus')(model.Status);

        EntityListService.rememberPreviousSelection($scope.containers, model, function onSelect(model){
          $scope.selectItem(model);
        });

        if (model.IP) {
          $scope.state.displayIP = true;
        }
        if ($scope.applicationState.endpoint.mode.provider === 'DOCKER_SWARM') {
          model.hostIP = $scope.swarm_hosts[_.split(container.Names[0], '/')[1]];
        }
        return model;
      });
      if (userDetails.role === 1) {
        UserService.users()
        .then(function success(data) {
          mapUsersToContainers(data);
        })
        .catch(function error(err) {
          Notifications.error("Failure", err, "Unable to retrieve users");
        })
        .finally(function final() {
          $('#loadContainersSpinner').hide();
        });
      } else {
        $('#loadContainersSpinner').hide();
      }
    }, function (e) {
      $('#loadContainersSpinner').hide();
      Notifications.error("Failure", e, "Unable to retrieve containers");
      $scope.containers = [];
    });
  };

  var batch = function (items, action, msg) {
    $('#loadContainersSpinner').show();
    var counter = 0;
    var complete = function () {
      counter = counter - 1;
      if (counter === 0) {
        $('#loadContainersSpinner').hide();
        update({all: Settings.displayAll ? 1 : 0});
      }
    };
    angular.forEach(items, function (c) {
      if (c.Checked) {
        counter = counter + 1;
        if (action === Container.start) {
          action({id: c.Id}, {}, function (d) {
            Notifications.success("Container " + msg, c.Id);
            complete();
          }, function (e) {
            Notifications.error("Failure", e, "Unable to start container");
            complete();
          });
        }
        else if (action === Container.remove) {
          action({id: c.Id}, function (d) {
            if (d.message) {
              Notifications.error("Error", d, "Unable to remove container");
            }
            else {
              if (c.Metadata && c.Metadata.ResourceControl) {
                ResourceControlService.removeContainerResourceControl(c.Metadata.ResourceControl.OwnerId, c.Id)
                .then(function success() {
                  Notifications.success("Container " + msg, c.Id);
                })
                .catch(function error(err) {
                  Notifications.error("Failure", err, "Unable to remove container ownership");
                });
              } else {
                Notifications.success("Container " + msg, c.Id);
              }
            }
            complete();
          }, function (e) {
            Notifications.error("Failure", e, 'Unable to remove container');
            complete();
          });
        }
        else if (action === Container.pause) {
          action({id: c.Id}, function (d) {
            if (d.message) {
              Notifications.success("Container is already paused", c.Id);
            } else {
              Notifications.success("Container " + msg, c.Id);
            }
            complete();
          }, function (e) {
            Notifications.error("Failure", e, 'Unable to pause container');
            complete();
          });
        }
        else {
          action({id: c.Id}, function (d) {
            Notifications.success("Container " + msg, c.Id);
            complete();
          }, function (e) {
            Notifications.error("Failure", e, 'An error occured');
            complete();
          });

        }
      }
    });
    if (counter === 0) {
      $('#loadContainersSpinner').hide();
    }
  };

  $scope.selectItems = function (allSelected) {
    angular.forEach($scope.state.filteredContainers, function (container) {
      if (container.Checked !== allSelected) {
        container.Checked = allSelected;
        $scope.selectItem(container);
      }
    });
  };

  $scope.selectItem = function (item) {
    if (item.Checked) {
      $scope.state.selectedItemCount++;
    } else {
      $scope.state.selectedItemCount--;
    }
  };

  $scope.toggleGetAll = function () {
    Settings.displayAll = $scope.state.displayAll;
    update({all: Settings.displayAll ? 1 : 0});
  };

  $scope.startAction = function () {
    batch($scope.containers, Container.start, "Started");
  };

  $scope.stopAction = function () {
    batch($scope.containers, Container.stop, "Stopped");
  };

  $scope.restartAction = function () {
    batch($scope.containers, Container.restart, "Restarted");
  };

  $scope.killAction = function () {
    batch($scope.containers, Container.kill, "Killed");
  };

  $scope.pauseAction = function () {
    batch($scope.containers, Container.pause, "Paused");
  };

  $scope.unpauseAction = function () {
    batch($scope.containers, Container.unpause, "Unpaused");
  };

  $scope.removeAction = function () {
    batch($scope.containers, Container.remove, "Removed");
  };

  function retrieveSwarmHostsInfo(data) {
    var swarm_hosts = {};
    var systemStatus = data.SystemStatus;
    var node_count = parseInt(systemStatus[3][1], 10);
    var node_offset = 4;
    for (i = 0; i < node_count; i++) {
      var host = {};
      host.name = _.trim(systemStatus[node_offset][0]);
      host.ip = _.split(systemStatus[node_offset][1], ':')[0];
      swarm_hosts[host.name] = host.ip;
      node_offset += 9;
    }
    return swarm_hosts;
  }

  Config.$promise.then(function (c) {
    $scope.containersToHideLabels = c.hiddenLabels;
    if ($scope.applicationState.endpoint.mode.provider === 'DOCKER_SWARM') {
      Info.get({}, function (d) {
        $scope.swarm_hosts = retrieveSwarmHostsInfo(d);
        update({all: Settings.displayAll ? 1 : 0});
      });
    } else {
      update({all: Settings.displayAll ? 1 : 0});
    }
  });
}]);
