import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Inject,
  Input,
  OnInit,
  Output,
  ViewChild,
  ViewContainerRef
} from '@angular/core';
import {MatAutocompleteSelectedEvent, MatAutocompleteTrigger} from '@angular/material/autocomplete';
import {Facet, FacetConfig, FacetDataType, FacetFilterType, FacetIdentifierStrategy, FacetResultType} from './models';
import {MatChipSelectionChange} from '@angular/material/chips';
import {FacetDetailsModalComponent} from './modals/facet-details-modal/facet-details-modal.component';
import {fromEvent} from 'rxjs';
import {debounceTime, distinctUntilChanged, filter, map} from 'rxjs/operators';
import {FACET_CONFIG} from './ngx-mat-facet.config';
import {VCRefInjector} from './misc/parent.helper';
import {v4 as uuidv4} from 'uuid';
import {FacetModalService} from './modals/facet-modal.service';
import {chipAnimation} from './ngx-mat-facet-search.animations';
import {FacetStorageService} from './services/facet-storage.service';

@Component({
  selector: 'ngx-mat-facet-search',
  templateUrl: 'ngx-mat-facet-search.component.html',
  styleUrls: ['./ngx-mat-facet-search.component.scss'],
  animations: [
    chipAnimation
  ]
})
export class NgxMatFacetSearchComponent implements OnInit, AfterViewInit {

  @Input() placeholder = 'Filter Table...';
  @Input() clearButtonText = 'Clear Filters';
  @Input() clearButtonEnabled = true;
  @Input() dateFormat = 'M/d/yyyy';

  @Input() tooltip: string | null = null;
  @Input() displayFilterIcon = true;
  @Input() facetWidth = '400px';
  @Input() facetHasBackdrop = true;
  @Input() confirmOnRemove = true;
  @Input() chipLabelsEnabled = true;
  @Input() identifier: string | null;

  @Input() set source(facets: Facet[]) {
    if (!!facets && facets.length > 0) {
      this.sourceFacets = facets;

      this.selectedFacets = this.selectedFacets.filter(s => facets.some(f => f.name === s.name));
      this.availableFacets = facets.map(f => Object.assign({}, f)).filter(f => !this.selectedFacets.some(s => s.name === f.name));
      this.filteredFacets = this.availableFacets;

      this.updateSelectedFacets();
    }
  }

  @Output() searchUpdated: EventEmitter<Facet[]>;

  @ViewChild('filterInput') filterInput: ElementRef;
  @ViewChild(MatAutocompleteTrigger, {read: MatAutocompleteTrigger}) inputAutoComplete: MatAutocompleteTrigger;

  public selectedFacet: Facet | undefined;
  public selectedFacets: Facet[] = [];
  public availableFacets: Facet[] = [];
  public filteredFacets: Facet[] = [];
  public FacetDataType = FacetDataType;
  public FacetFilterType = FacetFilterType;
  public allowDebugClick = false;

  private sourceFacets: Facet[] = [];
  private timeoutHandler: any;
  private identifierStrategy: FacetIdentifierStrategy;
  private injectorRef: VCRefInjector;

  constructor(@Inject(FACET_CONFIG) configuration: FacetConfig,
              public modal: FacetModalService,
              private storageService: FacetStorageService,
              private vcRef: ViewContainerRef) {

    this.injectorRef = new VCRefInjector(this.vcRef.injector);
    this.searchUpdated = new EventEmitter<Facet[]>();
    this.reconfigure(configuration);

    this.searchUpdated.subscribe(facets => {
      this.loggingCallback('Facet(s) updated', facets);
    });
  }

  private static getFixedURL(): string {
    return window.location.pathname.toString()
      .replace(/\s+/g, '-')
      .replace(/\//g, '-')
      .replace(/^-/g, '')
      .replace(/--/g, '-');
  }

  ngOnInit(): void {
    if (!this.identifier) {
      this.generateIdentity();
    } else {
      this.updateSelectedFacets();
    }
  }

  ngAfterViewInit(): void {
    fromEvent(this.filterInput.nativeElement, 'keyup')
      .pipe(
        filter(Boolean),
        debounceTime(150),
        distinctUntilChanged(),
        map(() => this.filterInput.nativeElement.value)
      ).subscribe((filterText) => {
      if (!!filterText && filterText.length > 0) {
        this.filteredFacets = this.availableFacets.filter(f => !!f && !!f.name && f.name.toLowerCase().includes(filterText.toLowerCase()));
      } else {
        this.filteredFacets = this.availableFacets;
      }
    });

    if (this.selectedFacets.length > 0) {
      this.emitSelectedEvent();
    }
  }

  chipSelected(event: MatChipSelectionChange, facet: Facet): void {
    if (event.selected && !facet.readonly) {
      const elementRef = event.source._elementRef.nativeElement;

      this.facetSelected(facet, {
        top: (elementRef.clientHeight - 5),
        left: -3,
      }, true, elementRef);
    }
  }

  autoCompleteDisplay(_: any): string {
    return null as unknown as string;
}

  autoCompleteSelected(event: MatAutocompleteSelectedEvent): void {
    const selectedFacet: Facet = event.option.value;
    const parentElement = this.filterInput.nativeElement;

    if (!!parentElement) {
      const elementRef = parentElement.getBoundingClientRect();
      const top = elementRef.height - 3;
      const left = -38;

      this.facetSelected(selectedFacet, {top, left}, false, this.filterInput);
    }
  }

  facetSelected(facet: Facet, position: { top: number; left: number | undefined }, isUpdate: boolean, target: any): void {
    this.promptFacet(Object.assign({}, facet), position, isUpdate, target);
  }

  promptFacet(facet: Facet, position: { top: number; left: number | undefined }, isUpdate: boolean, target: any): void {
    this.filteredFacets = this.availableFacets;


    const facetDetailsModal = this.modal.open(FacetDetailsModalComponent, target, {
      data: facet,
      offsetY: position.top,
      offsetX: position.left,
      isUpdate
    });


    facetDetailsModal.beforeClosed().subscribe(() => {
      this.selectedFacet = undefined;
    });

    facetDetailsModal.afterClosed().subscribe(result => {
      if (result.type === FacetResultType.REMOVE) {
        this.removeFacet(result.data);
      } else if (result.type === FacetResultType.ADD) {
        this.addOrUpdateFacet(result.data);
      }
    });
  }

  addOrUpdateFacet(facet: Facet): void {
    const index = this.selectedFacets.findIndex(f => f.name === facet.name);
    if (index > -1) {
      this.selectedFacets[index] = facet;
    } else {
      this.selectedFacets.push(facet);
    }
    this.emitSelectedEvent();
    this.storageService.updateSavedFacets(this.identifier, this.selectedFacets);
  }

  removeFacet(facet: Facet): boolean {
    if (!this.confirmOnRemove || (this.confirmOnRemove && confirm('Do you really want to remove "' + facet.labelText + '" filter?'))) {
      this.selectedFacets = this.selectedFacets.filter(f => f.name !== facet.name);
      this.emitSelectedEvent();
      this.storageService.updateSavedFacets(this.identifier, this.selectedFacets);
      return true;
    }
    return false;
  }

  updateSelectedFacets(): void {
    this.loggingCallback('Updating selected facets:', this.selectedFacets);

    this.sourceFacets.filter(facet => facet && facet.values && Array.isArray(facet.values))
      .forEach(facet => this.selectedFacets.push(facet));

    this.selectedFacets = this.storageService.loadFacetsFromStorage(this.identifier)
      .filter(facet => this.availableFacets.findIndex(f => f.name === facet.name) > -1)
      .map(facet => {

        const availableFacet = this.availableFacets.find(f => f.name === facet.name);

        if (!!availableFacet) {
          availableFacet.values = facet.values;
        }

        return availableFacet;
      })
      .filter(facet => !!facet) as Facet[];

    if (this.selectedFacets.length > 0) {
      this.emitSelectedEvent();
    } else {
      this.reset();
    }
  }

  updateAvailableFacets(): void {
    this.availableFacets = this.sourceFacets.map(f => Object.assign({}, f)).filter(f => !this.selectedFacets.some(s => s.name === f.name));
    this.filteredFacets = this.availableFacets;
  }

  reset(): void {
    this.selectedFacets = this.sourceFacets.filter(facet => facet.readonly === true);
    this.emitSelectedEvent();
    this.storageService.clearStorage(this.identifier);
  }

  emitSelectedEvent(): void {
    this.updateAvailableFacets();
    this.searchUpdated.next(this.selectedFacets.map(facet => ({
          name: facet.name,
          labelText: facet.labelText,
          type: facet.type,
          values: (facet.values || []).map(val => ({
              value: val.value,
              labelText: val.text,
              type: val.type,
              active: true
            })
          )
        })
      )
    );
  }

  focus(event: MouseEvent) {
    event.stopPropagation();
    this.inputAutoComplete.openPanel();
  }

  onKeyup(event: KeyboardEvent) {
    const inputValue = this.filterInput.nativeElement.value;
    const inputLength = this.filterInput.nativeElement.value.length;

    if (event.code === 'Backspace' && inputLength > 0) {
      this.filterInput.nativeElement.value = inputValue.substring(0, inputLength - 1);

      const filterText = this.filterInput.nativeElement.value;

      if (!!filterText && filterText.length > 0) {
        this.filteredFacets = this.availableFacets.filter(f => !!f && !!f.name && f.name.toLowerCase().includes(filterText.toLowerCase()));
      } else {
        this.filteredFacets = this.availableFacets;
      }
    }
  }

  /**
   * Update the identity of this Facet Search Component
   * This function does NOT reload/re-fetch previously saved facets from localStorage
   *
   * @param identifier - new identifier for the component
   */
  identify(identifier: string | null | undefined) {
    this.loggingCallback(`Identifying facet with ID: ${identifier}`);
    if (!identifier || identifier.length === 0 || identifier === '-') {
      this.identifier = 'default-facet';
    } else {
      this.identifier = `${identifier}-facet`;
    }
  }

  /**
   * Returns the FacetIdentifierStrategy currently being used for identity generation
   */
  getIdentifierStrategy(): FacetIdentifierStrategy {
    return this.identifierStrategy;
  }

  /**
   * Prints this component's identity to console
   */
  printIdentity() {
    console.log(this.identifier);
    this.updateAvailableFacets();
  }

  /// DEBUG - Long Click Filter Icon
  clickStarted() {
    if (!this.allowDebugClick) {
      return;
    }

    this.timeoutHandler = setTimeout(() => {
      this.printIdentity();
      this.timeoutHandler = null;
    }, 1000);
  }

  clickEnded() {
    if (this.timeoutHandler) {
      clearTimeout(this.timeoutHandler);
      this.timeoutHandler = null;
    }
  }

  /**
   * Reconfigure this Facet Search Component
   * This function will reload the previously saved facets from localStorage if they exist
   *
   * @param configuration - Partial FacetConfig
   * @param identity - Optional identity parameter if you want to override or provide a manual value
   */
  reconfigure(configuration?: Partial<FacetConfig> | FacetConfig | null, identity?: string) {
    if (!!configuration) {
      if (configuration.hasOwnProperty('allowDebugClick')) {
        this.allowDebugClick = configuration.allowDebugClick || false;
      }

      if (configuration.hasOwnProperty('identifierStrategy')) {
        this.identifierStrategy = configuration.identifierStrategy || FacetIdentifierStrategy.ParentID;
      }

      if (configuration.hasOwnProperty('loggingCallback') && !!configuration.loggingCallback) {
        this.loggingCallback = configuration.loggingCallback;
      }
    }

    this.generateIdentity(identity);
    this.loggingCallback('Reconfigured', this.identifier);
    this.storageService.updateLoggingCallback(this.loggingCallback);
  }

  getValue(facet: Facet, offset?: number): any {
    if (!!facet && !!facet.values && facet.values.length > 0 && !!facet.values[offset || 0].value) {
      return facet.values[offset || 0].value as unknown as any;
    }

    return null;
  }


  getType(facet: Facet, offset?: number): any {
    if (!!facet && !!facet.values && facet.values.length > 0 && !!facet.values[offset || 0].type) {
      return facet.values[offset || 0].type as unknown as any;
    }

    return null;
  }

  setValue(facet: Facet, newValue: any, offset?: number) {
    if (!!facet && !!facet.values && facet.values.length > 0 && !!facet.values[offset || 0]) {
      facet.values[offset || 0].value = newValue;
    }
  }

  /**
   * Generates an identity for a Facet Search Component
   *
   * @param manual - manually set the identifier
   * @private
   */
  private generateIdentity(manual?: string) {
    let identity;

    this.loggingCallback('Generating ID with strategy', this.identifierStrategy);

    switch (this.identifierStrategy) {
      case FacetIdentifierStrategy.WindowURL:
        identity = NgxMatFacetSearchComponent.getFixedURL();
        break;
      case FacetIdentifierStrategy.ParentID:
        identity = this.injectorRef.parentIdentifier;
        break;
      case FacetIdentifierStrategy.Random:
        identity = uuidv4();
        break;
      default:
        identity = manual;
        break;
    }

    this.identify(identity);
  }

  private loggingCallback: (...args: any[]) => void = () => {
  };
}
