//-- copyright
// OpenProject is an open source project management software.
// Copyright (C) 2012-2021 the OpenProject GmbH
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 3.
//
// OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
// Copyright (C) 2006-2013 Jean-Philippe Lang
// Copyright (C) 2010-2013 the ChiliProject Team
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
//
// See docs/COPYRIGHT.rdoc for more details.
//++

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  ViewEncapsulation,
  NgZone, AfterViewInit
} from '@angular/core';
import { Observable, of } from "rxjs";
import { map, tap } from "rxjs/operators";
import { APIV3Service } from "../../apiv3/api-v3.service";
import { GlobalSearchService } from "core-app/core/global_search/services/global-search.service";
import { LinkHandling } from "core-app/shared/helpers/link-handling/link-handling";
import { Highlighting } from "core-app/features/work-packages/components/wp-fast-table/builders/highlighting/highlighting.functions";
import { DeviceService } from "core-app/core/browser/device.service";
import { ContainHelpers } from "core-app/shared/directives/focus/contain-helpers";
import { HalResourceNotificationService } from "core-app/features/hal/services/hal-resource-notification.service";
import { I18nService } from "core-app/core/i18n/i18n.service";
import { CurrentProjectService } from "core-app/core/current-project/current-project.service";
import { PathHelperService } from "core-app/core/path-helper/path-helper.service";
import { OpAutocompleterComponent } from "core-app/shared/components/autocompleter/op-autocompleter/op-autocompleter.component";
import { WorkPackageResource } from "core-app/features/hal/resources/work-package-resource";
import { HalResourceService } from "core-app/features/hal/services/hal-resource.service";
import { HalResource } from "core-app/features/hal/resources/hal-resource";

export const globalSearchSelector = 'global-search-input';

interface SearchResultItem {
  id:string;
  subject:string;
  status:string;
  statusId:string;
  href:string;
  project:string;
  author:HalResource;
}

interface SearchOptionItem {
  projectScope:string;
  text:string;
}

@Component({
  selector: globalSearchSelector,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './global-search-input.component.html',
  styleUrls: ['./global-search-input.component.sass', "./global-search-input-mobile.component.sass"],
  // Necessary because of ng-select
  encapsulation: ViewEncapsulation.None
})
export class GlobalSearchInputComponent implements AfterViewInit, OnDestroy {
  @ViewChild('btn', { static: true }) btn:ElementRef;
  @ViewChild(OpAutocompleterComponent, { static: true }) public ngSelectComponent:OpAutocompleterComponent;

  public expanded = false;
  public markable = false;
  public isLoading = false;

  getAutocompleterData = (query:string):Observable<any[]> => {
    return this.autocompleteWorkPackages(query);
  };

  public autocompleterOptions = {
    filters:[],
    resource:'work_packages',
    searchKey:'subjectOrId',
    getOptionsFn: this.getAutocompleterData
  };

  /** Remember the current value */
  public currentValue = '';
  public isFocusedDirectly = (this.globalSearchService.searchTerm.length > 0);

  /** Remember the item that best matches the query.
   * That way, it will be highlighted (as we manually mark the selected item) and we can handle enter.
   * */
  public selectedItem:SearchResultItem|SearchOptionItem|null;

  private unregisterGlobalListener:Function|undefined;

  private isInitialized :boolean = false;
  public text:{ [key:string]:string } = {
    all_projects: this.I18n.t('js.global_search.all_projects'),
    current_project: this.I18n.t('js.global_search.current_project'),
    current_project_and_all_descendants: this.I18n.t('js.global_search.current_project_and_all_descendants'),
    search: this.I18n.t('js.global_search.search'),
    search_dots: this.I18n.t('js.global_search.search') + ' ...',
    close_search: this.I18n.t('js.global_search.close_search')
  };

  constructor(readonly elementRef:ElementRef,
              readonly I18n:I18nService,
              readonly apiV3Service:APIV3Service,
              readonly PathHelperService:PathHelperService,
              readonly halResourceService:HalResourceService,
              readonly globalSearchService:GlobalSearchService,
              readonly currentProjectService:CurrentProjectService,
              readonly deviceService:DeviceService,
              readonly cdRef:ChangeDetectorRef,
              readonly halNotification:HalResourceNotificationService,
              readonly ngZone:NgZone) {
  }

  ngAfterViewInit():void {
    // check searchterm on init, expand / collapse search bar and set correct classes
    this.ngSelectComponent.ngSelectInstance.searchTerm = this.currentValue = this.globalSearchService.searchTerm;
    this.expanded = (this.ngSelectComponent.ngSelectInstance.searchTerm.length > 0);
    this.toggleTopMenuClass();
  }

  ngOnDestroy():void {
    this.unregister();
  }

  // detect if click is outside or inside the element
  @HostListener('click', ['$event'])
  public handleClick(event:JQuery.TriggeredEvent):void {
    event.stopPropagation();
    event.preventDefault();

    // handle click on search button
    if (ContainHelpers.insideOrSelf(this.btn.nativeElement, event.target)) {
      if (this.deviceService.isMobile) {
        this.toggleMobileSearch();
        // open ng-select menu on default
        jQuery('.ng-input input').focus();
      } else if (this.ngSelectComponent.ngSelectInstance.searchTerm.length === 0) {
        this.ngSelectComponent.ngSelectInstance.focus();
      } else {
        this.submitNonEmptySearch();
      }
    }
  }

  // open or close mobile search
  public toggleMobileSearch() {
    this.expanded = !this.expanded;
    this.toggleTopMenuClass();
  }

  public redirectToWp(id:string, event:MouseEvent) {
    event.stopImmediatePropagation();
    if (LinkHandling.isClickedWithModifier(event)) {
      return true;
    }

    window.location.href = this.wpPath(id);
    event.preventDefault();
    return false;
  }

  public wpPath(id:string) {
    return this.PathHelperService.workPackagePath(id);
  }

  public search($event:any) {
    this.currentValue = this.ngSelectComponent.ngSelectInstance.searchTerm;
    this.openCloseMenu($event.term);
  }

  // close menu when input field is empty
  public openCloseMenu(searchedTerm:string) {

    this.ngSelectComponent.ngSelectInstance.isOpen = (searchedTerm.trim().length > 0);
  }

  public onFocus() {
    this.expanded = true;
    this.toggleTopMenuClass();
    this.openCloseMenu(this.currentValue);
  }

  public onFocusOut() {
    if (!this.deviceService.isMobile) {
      this.expanded = (this.ngSelectComponent.ngSelectInstance.searchTerm !== null && this.ngSelectComponent.ngSelectInstance.searchTerm.length > 0);
      this.ngSelectComponent.ngSelectInstance.isOpen = false;
      this.selectedItem =null;
      this.toggleTopMenuClass();
    }
  }

  public clearSearch() {
    this.currentValue = this.ngSelectComponent.ngSelectInstance.searchTerm = '';
    this.openCloseMenu(this.currentValue);
  }

  // If Enter key is pressed before result list is loaded, wait for the results to come
  // in and then decide what to do. If a direct hit is present, follow that. Otherwise,
  // go to the search in the current scope.
  public onEnterBeforeResultsLoaded() {
    if (this.selectedItem) {
      this.followSelectedItem();
    } else {
      this.searchInScope(this.currentScope);
    }
  }

  public statusHighlighting(statusId:string) {
    return Highlighting.inlineClass('status', statusId);
  }

  private get isDirectHit() {
    return this.selectedItem && this.selectedItem.hasOwnProperty('id');
  }

  public followItem(item:SearchResultItem|SearchOptionItem) {
    if (item.hasOwnProperty('id')) {
      window.location.href = this.wpPath((item as SearchResultItem).id);
    } else {
      // update embedded table and title when new search is submitted
      this.globalSearchService.searchTerm = this.currentValue;
      this.searchInScope((item as SearchOptionItem).projectScope);
    }
  }

  public followSelectedItem() {
    if (this.selectedItem) {
      this.followItem(this.selectedItem);
    }
  }

  // return all project scope items and all items which contain the search term
  public customSearchFn(term:string, item:any):boolean {
    return item.id === undefined || item.subject.toLowerCase().indexOf(term.toLowerCase()) !== -1;
  }

  private autocompleteWorkPackages(query:string):Observable<(SearchResultItem|SearchOptionItem)[]> {
    if (!query) {
      return of([]);
    }

    // Reset the currently selected item.
    // We do not follow the typical goal of an autocompleter of "setting a value" here.
    this.selectedItem = null;
    // Hide highlighting of ng-option
    this.markable = false;


    const hashFreeQuery = this.queryWithoutHash(query);


    this.isLoading = true
    return this
      .fetchSearchResults(hashFreeQuery, hashFreeQuery !== query)
      .get()
      .pipe(
        map((collection) => {
          return this.searchResultsToOptions(collection.elements, hashFreeQuery);
        }),
        tap(() => {
          this.isLoading = false;
          this.setMarkedOption();})
      );
  }

  // Remove ID marker # when searching for #<number>
  private queryWithoutHash(query:string) {
    if (query.match(/^#(\d+)/)) {
      return query.substr(1);
    } else {
      return query;
    }
  }

  private fetchSearchResults(query:string, idOnly:boolean) {
    return this
      .apiV3Service
      .work_packages
      .filterBySubjectOrId(query, idOnly);
  }

  private searchResultsToOptions(results:WorkPackageResource[], query:string) {
    const searchItems = results.map((wp) => {
      const item =  {
        id: wp.id!,
        subject: wp.subject,
        status: wp.status.name,
        statusId: wp.status.idFromLink,
        href: wp.href,
        project: wp.project.name,
        author: wp.author,
        type: wp.type
      } as SearchResultItem;
      // If we have a direct hit, we choose it to be the selected element.
      if (query === wp.id!.toString()) {
        this.selectedItem = item;
      }

      return item;
    });

    const searchOptions = this.detailedSearchOptions();

    if (!this.selectedItem) {
      this.selectedItem = searchOptions[0];
    }

    return (searchOptions as (SearchResultItem|SearchOptionItem)[]).concat(searchItems);
  }

  // set the possible 'search in scope' options for the current project path
  private detailedSearchOptions() {
    const searchOptions = [];
    // add all options when searching within a project
    // otherwise search in 'all projects'
    if (this.currentProjectService.path) {
      searchOptions.push('current_project_and_all_descendants');
      searchOptions.push('current_project');
    }
    if (this.globalSearchService.projectScope === 'current_project') {
      searchOptions.reverse();
    }
    searchOptions.push('all_projects');

    return searchOptions.map((suggestion:string) => {
      return { projectScope: suggestion, text: this.text[suggestion] };
    });
  }

  /*
   * Set the marked ng-option within ng-select and apply the class to highlight marked options.
   *
   * ng-select differentiates between the selected and the marked option. The selected optinon is the option
   * that is binded via ng-model. The marked option is the one that the user is currently selecting (via mouse or keyboard up/down).
   * When hitting enter, the marked option is taken to be the new selected option. Ng-select will retain the index of the marked
   * option between individual searches. The selected option has no influence on the marked option. This is problematic
   * in our use case as the user might have:
   *   * the mouse hovering (deliberately or not) over the search options which will mark that option.
   *   * marked an option for a previous search but might then have decided to add/remove additional characters to the search.
   *
   * In both cases, whenever the user presses enter then, ng-select assigns the marked option to the ng-model.
   *
   * Our goal however is to either:
   *  * mark the direct hit (id matches) if it available
   *  * mark the first item if there is no direct hit
   *
   * And we need to update the marked option after every search.
   *
   * There is no way of doing this via the interface provided in the template. There is only [markFirst] and it neither allows us
   * to mark a direct hit, nor does it reset after a search. We handle this then by selecting the desired element once the
   * search results are back. We then set the marked option to be the selected option.
   *
   * In order to avoid flickering, a -markable modifyer class is unset/set before/after searching. This will unset the background until we
   * have marked the element we wish to.
   */
  private setMarkedOption() {
    this.markable = true;
    this.ngSelectComponent.ngSelectInstance.itemsList.markItem(this.ngSelectComponent.ngSelectInstance.itemsList.selectedItems[0]);

    this.cdRef.detectChanges();
  }

  private searchInScope(scope:string) {
    switch (scope) {
      case 'all_projects': {
        let forcePageLoad = false;
        if (this.globalSearchService.projectScope !== 'all') {
          forcePageLoad = true;
          this.globalSearchService.resultsHidden = true;
        }
        this.globalSearchService.projectScope = 'all';
        this.submitNonEmptySearch(forcePageLoad);
        break;
      }
      case 'current_project': {
        this.globalSearchService.projectScope = 'current_project';
        this.submitNonEmptySearch();
        break;
      }
      case 'current_project_and_all_descendants': {
        this.globalSearchService.projectScope = '';
        this.submitNonEmptySearch();
        break;
      }
    }
  }

  public submitNonEmptySearch(forcePageLoad = false) {
    this.globalSearchService.searchTerm = this.currentValue;
    if (this.currentValue.length > 0) {
      this.ngSelectComponent.ngSelectInstance.close();
      // Work package results can update without page reload.
      if (!forcePageLoad &&
        this.globalSearchService.isAfterSearch() &&
        this.globalSearchService.currentTab === 'work_packages') {
        window.history
          .replaceState({},
            `${I18n.t('global_search.search')}: ${this.ngSelectComponent.ngSelectInstance.searchTerm}`,
            this.globalSearchService.searchPath());

        return;
      }
      this.globalSearchService.submitSearch();
    }
  }

  public blur() {
    this.ngSelectComponent.ngSelectInstance.searchTerm = '';
    (<HTMLInputElement>document.activeElement).blur();
  }

  private get currentScope():string {
    const serviceScope = this.globalSearchService.projectScope;
    return (serviceScope === '') ? 'current_project_and_all_descendants' : serviceScope;
  }

  private unregister() {
    if (this.unregisterGlobalListener) {
      this.unregisterGlobalListener();
      this.unregisterGlobalListener = undefined;
    }
  }

  private toggleTopMenuClass() {
    jQuery('.op-app-header').toggleClass('op-app-header_search-open', this.expanded);
  }
}


